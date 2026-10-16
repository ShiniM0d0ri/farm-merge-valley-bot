// Orders: the three client-side phases of a workshop order.
//
// Slot states (OrdersModel.data): 0 idle, 1 offered, 2 cooking (+timerId), 3 cooked.
// All three transitions are client-side — the server never advances a slot, so an order
// nobody touches sits at state 2 forever.
//
//   start    slot 1 -> 2, slot gains `timerId`, TimerModel gains `Order_<building>`.
//            Ingredients are deducted from InventoryModel.            HAR SAVE [23]
//   complete slot 2 -> 3 once that timer has elapsed; the timer is removed.
//            A short recipe can start *and* finish inside one save gap, which is why a
//            diff may jump 1 -> 3 (recipe_milk is 120 units = 60 s).   HAR SAVE [22]
//            Completion and collection are now chained into ONE save: a slot that finishes
//            in this save is collected in the same write (the client does both in one tick),
//            halving the round-trips per order.
//   collect  slot deleted; `Cooldown_<building>` added and
//            `buildings.<building>.cooldownTimerID` set to it; the recipe reward spawns
//            as tiles on free cells.                                    HAR SAVE [15]+[16]
//            (the reward was long mistaken for missing — it is in its own one-model save,
//             e.g. `recipe_milk -> coin_2 @ 73:71`)
//
// Duration units differ between the two configs and both are observed, not assumed:
//   recipe.duration 600  -> Order_bakery 300000 ms   (x500)
//   mapSource step  180  -> MapSourceCooldown 90000  (x500)   [same rule, see lib/work.js]
//   building.cooldown 3  -> Cooldown_market 3000 ms  (x1000)
'use strict';
import fs from 'node:fs';
import { tiles, freeCells, filledTile } from './board.js';
import { persistedState } from './blueprints.js';
import { cfgPath } from './env.js';

export const RECIPES_PATH = process.env.FMV_RECIPES || cfgPath('recipes_jsonpack.json');
export const BUILDINGS_PATH = process.env.FMV_BUILDINGS || cfgPath('buildings_jsonpack.json');
export const loadRecipes = (p = RECIPES_PATH) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const loadBuildings = (p = BUILDINGS_PATH) => JSON.parse(fs.readFileSync(p, 'utf8'));

export const ORDER_STATE = { 0: 'idle', 1: 'offered', 2: 'cooking', 3: 'cooked' };

/** Cooking timer length: `recipe.duration` is in 2-second units. */
export const recipeTimerMs = (recipe) => Math.round((recipe?.duration ?? 0) * 500);
/** Per-building collect cooldown: `building.cooldown` is in seconds. */
export const buildingCooldownMs = (building) => Math.round((building?.cooldown ?? 3) * 1000);

const slots = (models) => models.OrdersModel?.json?.data || [];

/** Slots whose cooking timer has elapsed (state 2 -> 3). */
export function planOrderCompletions(models, { recipes, now = Date.now() } = {}) {
  const timers = new Map((models.TimerModel?.json?.data?.timers || []).map((t) => [t.id, t]));
  const out = [];
  for (const slot of slots(models)) {
    if (slot.state !== 2 || slot.timerId === undefined) continue;
    const timer = timers.get(slot.timerId) || null;
    out.push({ slot, timer, due: timer ? timer.started + timer.duration : null, now });
  }
  return out;
}

/** Cooked slots waiting to be collected (state 3). */
export function planOrderCollects(models, { recipes } = {}) {
  return slots(models)
    .filter((s) => s.state === 3)
    .map((slot) => ({ slot, recipe: recipes?.[slot.recipe] || null }));
}

/**
 * Offered slots (state 1) the inventory can pay for, one per building.
 * A slot is skipped when its building is still on a collect cooldown.
 */
export function planOrderStarts(models, { recipes, buildings, now = Date.now() } = {}) {
  const inv = models.InventoryModel?.json?.data || {};
  const have = (k) => (typeof inv[k] === 'number' ? inv[k] : 0);
  // the LIVE building state holds `cooldownTimerID`; the static `buildings` config does not
  const live = models.BuildingsModel?.json?.data?.buildings || {};
  const running = new Set(
    (models.TimerModel?.json?.data?.timers || [])
      .filter((t) => now < t.started + t.duration)
      .map((t) => t.id)
  );

  const busy = new Set();
  for (const s of slots(models)) if (s.state === 2 && s.buildingID) busy.add(s.buildingID);

  const out = [];
  for (const slot of slots(models)) {
    if (slot.state !== 1) continue;
    if (!slot.buildingID || busy.has(slot.buildingID)) continue;
    const recipe = recipes?.[slot.recipe];
    if (!recipe) continue;
    // a building is out of action only while its collect-cooldown timer is still running
    const cdId = live[slot.buildingID]?.cooldownTimerID;
    if (cdId !== undefined && cdId !== null && running.has(cdId)) continue;
    const b = buildings?.[`${slot.buildingID}_config`];
    const ingredients = recipe.ingredients || [];
    if (ingredients.some((i) => have(i.key) < i.amount)) continue;
    out.push({ slot, recipe, building: b || null, ingredients });
    busy.add(slot.buildingID);
  }
  return out;
}

/**
 * Apply every phase. Returns model writes plus the TimerModel data the caller should
 * persist — `timerData` is threaded in because lib/work.js may already have edited the
 * timer list in the same save; writing our own copy would silently drop its timers.
 */
export function buildOrderUpdates(
  models,
  { bps, recipes, buildings, timerData, blocked, now = Date.now(), maxStarts = Infinity } = {}
) {
  const updates = new Map();
  const summaries = [];
  const completionSummaries = [];
  const collectSummaries = [];
  const startSummaries = [];
  const spent = {};
  const gains = {};
  let nextId = timerData?.nextTimerId ?? 0;
  const timers = timerData?.timers ? [...timerData.timers] : [];
  const drop = new Set();
  let touchedTimers = false;

  const addTimer = (label, duration) => {
    const id = nextId++;
    timers.push({ id, started: now, state: 'ACTIVE', label, duration, timeSource: 'server' });
    touchedTimers = true;
    return id;
  };

  // `buildings.<id>.cooldownTimerID` edits for this save. A number installs a new cooldown,
  // `null` clears the field (the key is dropped, exactly as the game does).
  const buildingEdits = {};

  // ---- expire finished collect-cooldowns ------------------------------------------
  // The client removes the Cooldown_<building> timer *and* clears
  // `buildings.<id>.cooldownTimerID` when it fires — that is what unblocks the building
  // for a new order (HAR SAVE [17]: market's field was cleared and bakery gained one).
  // Without this the field would stick forever and the building would never take an order.
  for (const t of timers) {
    const m = /^Cooldown_(.+)$/.exec(t.label || '');
    if (!m || now < t.started + t.duration) continue;
    buildingEdits[m[1]] = null;
    drop.add(t.id);
    touchedTimers = true;
  }

  // ---- complete: state 2 -> 3 once the cooking timer has fired --------------------
  const work = [...slots(models)];
  let completed = 0;
  for (const c of planOrderCompletions(models, { recipes, now })) {
    if (c.due === null || now < c.due) continue;
    const i = work.indexOf(c.slot);
    if (i < 0) continue;
    const { timerId, ...rest } = c.slot;
    work[i] = { ...rest, state: 3 };
    if (c.timer) { drop.add(c.timer.id); touchedTimers = true; }
    completed++;
    completionSummaries.push(`${c.slot.buildingID} ${c.slot.recipe} cooked (state 2 -> 3)`);
  }

  // ---- collect: delete the slot, start the building cooldown, spawn the reward ----
  // Collect off `work`, not `models`: a slot completed in this very save (2 -> 3 above) is
  // then collected in the same write, which is what the client does in a single tick. The
  // old code could only ever see the *previous* save's state-3 slots, which forced every
  // order through two SAVE round-trips (complete, then collect) instead of one.
  const taken = blocked ? new Set(blocked) : new Set();
  const collectedBuildings = new Set();
  let collected = 0;
  for (let i = work.length - 1; i >= 0; i--) {
    const slot = work[i];
    if (slot.state !== 3) continue;
    const recipe = recipes?.[slot.recipe] || null;
    work.splice(i, 1);
    const reward = recipe?.reward || [];
    const parts = [];
    for (const key of reward) {
      if (typeof (models.InventoryModel?.json?.data || {})[key] === 'number') {
        gains[key] = (gains[key] || 0) + 1;
        parts.push(`1 ${key}`);
      } else {
        const cells = freeCells(models, { row: 0, col: 0 }).filter((x) => !taken.has(x.key));
        const cell = cells.shift();
        if (!cell) { parts.push(`+${key}(board full!)`); continue; }
        taken.add(cell.key);
        updates.set(cell.key, filledTile(key, persistedState(bps, key)));
        parts.push(`+${key}@(${cell.row},${cell.col})`);
      }
    }
    const b = slot.buildingID;
    if (b) { buildingEdits[b] = addTimer(`Cooldown_${b}`, buildingCooldownMs(buildings?.[`${b}_config`])); collectedBuildings.add(b); }
    collected++;
    collectSummaries.push(`${b} ${slot.recipe} -> ${parts.join(', ') || '(no reward)'}`);
  }

  // ---- start: pay the ingredients, arm the cooking timer -------------------------
  // Never start on a building we just collected from: its cooldown timer is only created in
  // this save, so `planOrderStarts` (which reads the pre-save timer list) cannot see it yet.
  let started = 0;
  for (const s of planOrderStarts(models, { recipes, buildings })) {
    if (started >= maxStarts) break;
    if (s.slot.buildingID && collectedBuildings.has(s.slot.buildingID)) continue;
    const i = work.findIndex((x) => x === s.slot);
    if (i < 0) continue;
    const timerId = addTimer(`Order_${s.slot.buildingID}`, recipeTimerMs(s.recipe));
    work[i] = { ...s.slot, state: 2, timerId };
    for (const ing of s.ingredients) spent[ing.key] = (spent[ing.key] || 0) + ing.amount;
    started++;
    startSummaries.push(
      `${s.slot.buildingID} ${s.slot.recipe}  ${s.ingredients.map((x) => `${x.amount} ${x.key}`).join(' + ')}` +
        `  -> ${(s.recipe.reward || []).join(', ')}  ${Math.round(recipeTimerMs(s.recipe) / 1000)}s`
    );
  }

  // ---- OrdersModel ---------------------------------------------------------------
  if (completed || collected || started) {
    const om = models.OrdersModel?.json;
    updates.set('OrdersModel', { data: work, version: om?.version ?? 1 });
  }

  // ---- BuildingsModel: install new cooldowns, drop expired ones -------------------
  if (Object.keys(buildingEdits).length) {
    const bm = models.BuildingsModel?.json;
    if (bm?.data?.buildings) {
      const next = { ...bm.data.buildings };
      let changed = false;
      for (const [id, timerId] of Object.entries(buildingEdits)) {
        if (!next[id]) continue;
        if ((next[id].cooldownTimerID ?? null) === timerId) continue;
        const { cooldownTimerID, ...rest } = next[id];
        next[id] = timerId === null ? rest : { ...rest, cooldownTimerID: timerId };
        changed = true;
      }
      if (changed) updates.set('BuildingsModel', { data: { ...bm.data, buildings: next }, version: bm.version ?? 1 });
    }
  }

  // The seasonal-pass quest ("order.rewarded") is advanced by lib/daily.js, which sums every action
  // in the save - a second copy here would double-count it.

  let nextTimerData = timerData || null;
  if (touchedTimers) {
    // Includes any timer edits lib/work.js already made in this same save, because we
    // based ourselves on the TimerModel update it produced.
    nextTimerData = {
      ...(timerData || models.TimerModel?.json?.data || {}),
      timers: timers.filter((t) => !drop.has(t.id)),
      nextTimerId: nextId,
    };
    updates.set('TimerModel', { data: nextTimerData, version: models.TimerModel?.json?.version ?? 1 });
  }

  if (completionSummaries.length) summaries.push(...completionSummaries.map((s) => `cooked: ${s}`));
  if (collectSummaries.length) summaries.push(...collectSummaries.map((s) => `collect: ${s}`));
  if (startSummaries.length) summaries.push(...startSummaries.map((s) => `start: ${s}`));

  return {
    updates, timerData: nextTimerData, summaries,
    completionSummaries, collectSummaries, startSummaries,
    spent, gains, completed, collected, started,
  };
}
