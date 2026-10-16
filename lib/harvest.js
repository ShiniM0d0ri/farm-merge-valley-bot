// Tier-4 producers: the merge -> cooldown -> materialise -> loot lifecycle.
//
// Decoded from the launch capture's initial read plus its first saves (see MECHANICS.md §4):
//
//   READ  GET_ALL_PLAYER_DATA_V2, 09:24:13Z - TimerModel holds the producer timers:
//         {"id":2129,"label":"Cooldown:66,71","state":"ACTIVE","started":1792086244134,
//          "duration":1800000,"timeSource":"server"}                        <- 30 min
//   tile  {"cooldown":{"timerId":2129},"hitpoints":{"startAsVisible":false,"max":1,"current":2}}
//         and `harvestable.duration` is 3600, i.e. 3600 * 500 ms = the 1800000 the timer carries.
//
//   SAVE  t+0.0s  all six are DELETED from TimerModel (they were already overdue at load) and
//   SAVE  t+6.3s  the tiles are still in `cooldown` (tile writes lag the timer sweep)
//   SAVE  t+10.0s the tiles materialise:
//         {"hitpoints":{"startAsVisible":false,"max":1,"current":2},
//          "lootable":{"loot":["egg","egg","egg","egg","egg"],"lootingRemovesObject":false}}
//
// So materialisation is driven by an EXPIRED timer, and the spent timer is deleted. A producer
// whose `cooldown.timerId` has no timer at all never materialises - which is how 21 live producers
// ended up permanently inert (they also carried `data == {}`, the merge-write bug this file fixes).
//
// The loot itself is a client-side roll. `harvestable.harvestReward` is `[harvestRound][slot]`, each
// slot `{chance, items:[{key, weight, unsuccessfulAttemptsThreshhold, increaseWeightAmount}]}`; a slot
// contributes one item when its `chance` roll passes. Pity state lives in PseudoRandomnessModel keyed
// by the producer's blueprint id (`context: "wheat_4"`), exactly like crates (lib/crates.js). The
// client's PRNG is unknown, so a roll matches the *distribution* rather than the exact draw - the same
// standing approximation as crate contents, which were applied live and verified.
'use strict';
import { tiles, filledTile } from './board.js';
import { resolveBlueprint } from './blueprints.js';

/** `harvestable.duration` (seconds) -> ms is x500; pinned by the observed timer to 1800000 (30 min). */
export const HARVEST_DURATION_MS = 1800000;
/** The `hitpoints.max` every observed producer carries (it is not `harvests`). */
export const HARVEST_HP_MAX = 1;

export const cooldownLabel = (row, col) => `Cooldown:${row},${col}`;

/**
 * The cooldown a producer's timer should carry. The one observed timer (a `*_4`, whose config
 * `duration` is 3600) reads 1800000, so the rule is `duration * 500` ms. Applied per blueprint,
 * which leaves `*_4` at the pinned 30 min and makes `gazebo`/`greenhouse` (`duration` 86400) 12 h -
 * an extrapolation, and the only blueprints it affects.
 */
export function producerDuration(bps, id) {
  const d = harvestableOf(bps, id)?.duration;
  return Number.isFinite(d) && d > 0 ? d * 500 : HARVEST_DURATION_MS;
}

export function harvestableOf(bps, id) {
  return (bps && resolveBlueprint(bps, id)?.harvestable) || null;
}

/** Is this blueprint a harvestable producer (tier-4 animals/crops, and whatever else carries one)? */
export function isProducer(bps, id) {
  return !!harvestableOf(bps, id);
}

/** The tile state a producer gets the moment it is merged into. */
export function producerState(bps, id, timerId) {
  const h = harvestableOf(bps, id) || {};
  return {
    cooldown: { timerId },
    hitpoints: { startAsVisible: false, max: HARVEST_HP_MAX, current: h.harvests ?? 2 },
  };
}

/** The tile state a producer gets when its cooldown lands and it becomes lootable. */
export function materialisedState(hitpoints, loot) {
  return {
    hitpoints: { startAsVisible: false, max: HARVEST_HP_MAX, ...hitpoints },
    lootable: { loot, lootingRemovesObject: false },
  };
}

// ---- the loot roll ------------------------------------------------------------

function pickWeighted(items, rng) {
  const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
  if (!(total > 0)) return null;
  let r = rng() * total;
  for (const i of items) {
    r -= Math.max(0, i.weight);
    if (r < 0) return i.key;
  }
  return items[items.length - 1].key;
}

/** weightIncrease currently banked for `key` in a PseudoRandomness context. */
function weightIncreaseOf(ctx, key) {
  const it = ctx?.items?.find((i) => i.key === key);
  return it?.weightIncrease || 0;
}

/** Advance the pity state after one slot roll, mirroring lib/crates.js. */
function advancePity(ctx, items, picked) {
  if (!ctx?.items) return;
  for (const it of ctx.items) {
    const cfg = items.find((c) => c.key === it.key);
    if (!cfg) continue;
    if (it.key === picked) {
      it.unsuccesfulAttempts = 0;
      it.weightIncrease = 0;
      if (cfg.cooldownDuration) it.cooldownAmount = cfg.cooldownDuration;
      continue;
    }
    if (it.cooldownAmount > 0) it.cooldownAmount -= 1;
    it.unsuccesfulAttempts = (it.unsuccesfulAttempts || 0) + 1;
    if (it.unsuccesfulAttempts > (cfg.unsuccessfulAttemptsThreshhold || 0)) {
      it.weightIncrease = (it.weightIncrease || 0) + (cfg.increaseWeightAmount || 0);
    }
  }
}

/**
 * Roll one harvest's loot. `round` is the harvest index (0 for the first).
 * Returns the array of keys the game would put in `lootable.loot`.
 */
export function drawHarvest(harvestable, ctx, round = 0, rng = Math.random) {
  const rounds = harvestable?.harvestReward || [];
  if (!rounds.length) return [];
  const slots = rounds[Math.min(round, rounds.length - 1)] || [];
  const out = [];
  for (const slot of slots) {
    const chance = slot.chance ?? 100;
    if (!(rng() * 100 < chance)) continue;
    const items = (slot.items || []).map((it) => ({ ...it, weight: (it.weight || 0) + weightIncreaseOf(ctx, it.key) }));
    const picked = pickWeighted(items, rng);
    if (!picked) continue;
    out.push(picked);
    advancePity(ctx, slot.items || [], picked);
  }
  return out;
}

// ---- planning -----------------------------------------------------------------

/**
 * Producers that should materialise this save: they carry a `cooldown` whose timer has elapsed - or
 * whose timer is gone entirely (only possible for tiles written before the cooldown and its timer
 * were written together, i.e. the pre-fix merge bug). The game's own sweep is "expired timer ->
 * materialise", so both are the same action from the board's point of view.
 */
export function planMaterialisations(models, { bps, now = Date.now() } = {}) {
  const tm = models.TimerModel?.json?.data;
  const byId = new Map((tm?.timers || []).filter(Boolean).map((t) => [t.id, t]));
  const out = [];
  for (const v of tiles(models).values()) {
    if (!v?.blueprint || !v.data?.cooldown) continue;
    if (v.data.lootable || v.data.depleted) continue;
    if (!isProducer(bps, v.blueprint)) continue;
    const t = byId.get(v.data.cooldown.timerId) || null;
    if (t && t.started + t.duration > now) continue;
    out.push({ tile: v, timer: t, timerId: v.data.cooldown.timerId, why: t ? 'expired' : 'timer-missing' });
  }
  return out;
}

/**
 * Producers carrying no lifecycle state at all - `data == {}`, the tier-4 merge write before
 * `producerState` existed. They cannot merge, cannot be looted and never produce, so they are dead
 * tiles. Give them a fresh cooldown (starting now) so the normal path takes over.
 */
export function planRepairs(models, { bps } = {}) {
  const out = [];
  for (const v of tiles(models).values()) {
    if (!v?.blueprint || !isProducer(bps, v.blueprint)) continue;
    const d = v.data || {};
    if (d.cooldown || d.lootable || d.depleted) continue;
    out.push({ tile: v });
  }
  return out;
}

// ---- the write ----------------------------------------------------------------

/**
 * Everything the producer lifecycle needs in one save:
 *   - brand new producers created by this round's merges (`moves`) get their cooldown + timer;
 *   - producers whose cooldown landed materialise (loot rolled, timer deleted);
 *   - inert producers are repaired with a fresh cooldown.
 * Also advances PseudoRandomnessModel for every context it rolled in.
 */
export function buildHarvestUpdates(models, { bps, moves = [], now = Date.now(), rng = Math.random, repair = true, timerData } = {}) {
  const updates = new Map();
  const summaries = [];
  const tm = models.TimerModel?.json;

  const mergesInto = moves.filter((mv) => isProducer(bps, mv.target));
  // a producer cooldown is part of the merge itself, so new producers are always armed - only the
  // materialise/repair half is optional (`repair: false` via `--no-producers`).
  const planned = planMaterialisations(models, { bps, now });
  const repairs = repair ? planRepairs(models, { bps }) : [];
  if (!mergesInto.length && !repairs.length && !(repair && planned.length)) {
    return { updates, summaries, materialised: 0, repaired: 0 };
  }

  // work/orders/regen may already have edited TimerModel this round, so take the evolved data
  const data = timerData ?? tm?.data;
  if (!data || !Array.isArray(data.timers)) {
    return { updates, summaries, materialised: 0, repaired: 0, error: 'no TimerModel available' };
  }
  const todo = repair ? planned : [];

  const drop = new Set(todo.filter((p) => p.timer).map((p) => p.timer.id));
  const timers = data.timers.filter((t) => !drop.has(t.id));
  let nextTimerId = data.nextTimerId ?? 0;
  const arm = (row, col, bp) => {
    const id = nextTimerId++;
    timers.push({ id, started: now, state: 'ACTIVE', label: cooldownLabel(row, col), duration: producerDuration(bps, bp), timeSource: 'server' });
    return id;
  };

  // merge results: the planner wrote `persistedState`, which is `{}` for a producer. A bonus
  // (5-)merge produces two tiles, so each produced producer gets its own cooldown + timer.
  for (const mv of mergesInto) {
    for (const k of mv.keeps || [mv.keep]) {
      const id = arm(k.row, k.col, mv.target);
      updates.set(k.key, filledTile(mv.target, producerState(bps, mv.target, id)));
      summaries.push(`${mv.target} @ (${k.row},${k.col}) started producing (timer ${id}, ${Math.round(producerDuration(bps, mv.target) / 60000)} min)`);
    }
  }

  // PseudoRandomnessModel: one context per blueprint, exactly as the live save has it.
  const pr = models.PseudoRandomnessModel?.json;
  const contexts = pr?.data?.data ? JSON.parse(JSON.stringify(pr.data.data)) : null;
  const ctxFor = (id) => {
    if (!contexts) return null;
    let c = contexts.find((x) => x.context === id);
    if (!c) { c = { items: [], context: id }; contexts.push(c); }
    return c;
  };
  /** make sure the context knows every key the table can produce, so pity can accumulate */
  const seedContext = (ctx, h) => {
    for (const round of h.harvestReward || []) {
      for (const slot of round) {
        for (const it of slot.items || []) {
          if (!ctx.items.find((x) => x.key === it.key)) {
            ctx.items.push({ key: it.key, cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 0 });
          }
        }
      }
    }
  };

  let materialised = 0;
  for (const p of todo) {
    const h = harvestableOf(bps, p.tile.blueprint);
    if (!h) continue;
    // the harvest this loot belongs to: `current` counts down from `harvests`
    const hp = p.tile.data.hitpoints || { current: h.harvests ?? 2 };
    const round = Math.max(0, (h.harvests ?? 1) - (hp.current ?? 1));
    const ctx = ctxFor(p.tile.blueprint);
    if (ctx) seedContext(ctx, h);
    const loot = drawHarvest(h, ctx, round, rng);
    updates.set(p.tile.key, filledTile(p.tile.blueprint, materialisedState(hp, loot)));
    materialised++;
    summaries.push(
      `${p.tile.blueprint} @ (${p.tile.row},${p.tile.col}) materialised (${p.why}) -> ${loot.length} item(s)${loot.length ? `: ${loot.join(', ')}` : ''}`
    );
  }

  let repaired = 0;
  for (const r of repairs) {
    const id = arm(r.tile.row, r.tile.col, r.tile.blueprint);
    updates.set(r.tile.key, filledTile(r.tile.blueprint, producerState(bps, r.tile.blueprint, id)));
    repaired++;
    summaries.push(`${r.tile.blueprint} @ (${r.tile.row},${r.tile.col}) was inert (no cooldown) -> repaired, timer ${id}`);
  }

  updates.set('TimerModel', { data: { ...data, timers, nextTimerId }, version: tm.version ?? 1 });
  if (contexts && materialised) {
    updates.set('PseudoRandomnessModel', { data: { ...pr.data, data: contexts }, version: pr.version ?? 1 });
  }
  return { updates, summaries, materialised, repaired, droppedTimers: drop.size };
}
