// Merge planner: read state -> choose merges -> build the exact model writes.
'use strict';
import { tiles, freeCells, emptyTile, filledTile } from './board.js';
import { persistedState, resolveBlueprint, applyExp } from './blueprints.js';
import { planWork, planCompletions, buildWorkUpdates, buildCompletionUpdates } from './work.js';
import { buildCrateUpdates, loadRandomness } from './crates.js';
import { buildOrderUpdates, loadRecipes, loadBuildings } from './orders.js';
import { buildTaskUpdates } from './daily.js';
import { levelRewards, pendingVisitorRewards } from './rewards.js';
import { planRegen, buildRegenUpdates } from './regen.js';
import { buildHarvestUpdates } from './harvest.js';

export const MIN_MERGE = 3;

/**
 * The group sizes the client accepts, largest first. 3 identical tiles merge into 1 of the next
 * tier; 5 identical tiles are a *bonus* merge into 2 of the next tier (`totalBonusMerges`; the
 * effect sprite in the client bundle is literally `Merge_5_Floter`, and the onboarding teaches it
 * as `merge_bonus_*`). EXP is paid per *output* tile, so both objectives coincide.
 */
export const MERGE_SIZES = [5, 3];

/**
 * How many of each group size to use on `n` identical tiles to maximise output tiles.
 *   outputs = 2*bonus + normal   with   5*bonus + 3*normal <= n
 * f(b) = floor((n-5b)/3) + 2b is non-decreasing in b, so the maximum is at the largest legal b.
 * Ties (n = 6, 7, 12, 14 ...) go to the split with *more* 5-groups: it costs fewer tiles per
 * output, so the tiles it does not spend stay on the board as banked value (they merge as soon as
 * supply arrives) - e.g. n = 27 is five 5-groups (25 tiles, 2 banked) rather than three 5-groups
 * plus four 3-groups (27 tiles, nothing banked) for the same 10 outputs.
 */
export function bestSplit(n, sizes = MERGE_SIZES) {
  const five = sizes.includes(5);
  const three = sizes.includes(3);
  let best = { bonus: 0, normal: 0, outputs: 0, used: 0 };
  for (let bonus = 0; bonus * 5 <= n; bonus++) {
    if (bonus && !five) break;
    const normal = three ? Math.floor((n - bonus * 5) / 3) : 0;
    const cand = { bonus, normal, outputs: bonus * 2 + normal, used: bonus * 5 + normal * 3 };
    if (cand.outputs > best.outputs || (cand.outputs === best.outputs && cand.bonus > best.bonus)) {
      best = cand;
    }
  }
  return best;
}

const byCell = (a, b) => a.row - b.row || a.col - b.col;

/**
 * Plan every merge the board can pay for in one save, maximising output tiles (= EXP).
 *
 * Per blueprint the tiles are split by `bestSplit` (5-groups first, then 3-groups). A merge's
 * output is itself mergeable, so the outputs are fed back in and the planner iterates to a
 * fixpoint: 27 `wheat_1` -> 5 bonus + ... -> `wheat_2` -> ... -> `wheat_3` in a single plan.
 * Moves are emitted lowest tier first (an output only exists after the merge that made it), so
 * replaying them in order never writes the same cell twice.
 *
 * `keeps` are the cells that receive the output (2 for a bonus merge), `consume` the cells that
 * are emptied. `minMerge` is the smallest group size allowed, so `--min=5` forbids normal merges.
 */
export function planMerges(models, { minMerge = MIN_MERGE, bps } = {}) {
  const sizes = MERGE_SIZES.filter((s) => s >= minMerge);
  const moves = [];
  if (!sizes.length) return moves;

  const byBp = new Map();
  const seen = new Map();
  for (const v of tiles(models).values()) {
    if (!v || !v.blueprint) continue;
    if (!seen.has(v.blueprint)) seen.set(v.blueprint, v);
    if (!v.mergeable?.target) continue;
    if (!byBp.has(v.blueprint)) byBp.set(v.blueprint, []);
    byBp.get(v.blueprint).push(v);
  }
  // `mergeable` of a blueprint: the blueprint table wins (it is what a produced tile would be
  // written with), a real tile on the board is the fallback when no table was passed in.
  const mergeableOf = (bp) => {
    const fromTable = bps ? resolveBlueprint(bps, bp)?.mergeable : null;
    if (fromTable?.target) return fromTable;
    const t = seen.get(bp);
    return t?.mergeable?.target ? t.mergeable : null;
  };

  for (const list of byBp.values()) list.sort(byCell);

  let again = true;
  while (again) {
    again = false;
    // snapshot: a cascade can add a blueprint (the target tier) to `byBp` mid-pass
    for (const [blueprint, list] of [...byBp]) {
      const m = mergeableOf(blueprint);
      if (!m?.target) continue;
      const split = bestSplit(list.length, sizes);
      if (!split.outputs) continue;

      const groups = [];
      for (let i = 0; i < split.bonus; i++) groups.push(5);
      for (let i = 0; i < split.normal; i++) groups.push(3);

      const produced = [];
      let cursor = 0;
      for (const size of groups) {
        const used = list.slice(cursor, cursor + size);
        cursor += size;
        const keeps = used.slice(0, size === 5 ? 2 : 1);
        moves.push({
          blueprint,
          target: m.target,
          expReward: m.expReward,
          keeps,
          keep: keeps[0],
          consume: used.slice(keeps.length),
          bonus: size === 5,
          available: list.length,
        });
        // the outputs occupy the kept cells and are candidates for the next tier's merges
        for (const k of keeps) produced.push({ key: k.key, row: k.row, col: k.col, blueprint: m.target });
      }
      list.splice(0, cursor);
      if (produced.length) {
        const next = byBp.get(produced[0].blueprint);
        if (next) next.push(...produced);
        else byBp.set(produced[0].blueprint, produced);
        byBp.get(produced[0].blueprint).sort(byCell);
      }
      again = true;
    }
  }
  return moves;
}

/** Tiles whose production has finished (`lootable`) and can be tapped. */
export function planLoots(models) {
  const out = [];
  for (const v of tiles(models).values()) {
    if (!v || !v.blueprint) continue;
    const l = v.data?.lootable;
    if (!Array.isArray(l?.loot) || !l.loot.length) continue;
    out.push({ tile: v, loot: l.loot, removesObject: !!l.lootingRemovesObject });
  }
  return out;
}

/** Existing-but-empty cells, nearest to `near` first. */

/**
 * Turn plans into concrete model writes.
 * Returns { updates, expGained, levelInfo, summaries, collectSummaries, lootSummaries, gains }
 *
 * Merging and collecting are value-neutral for coin/energy tiers (each is 3x the previous),
 * but merging pays EXP, so tiles that can still be merged are never collected.
 * Looting needs no RNG: `lootable.loot` is already the rolled result sitting on the tile.
 */
export function buildUpdates(
  models, moves,
  { bps, progression, collect = true, loot = true, work = true, crates = 0, orders = true, recipes, buildings, reserveEnergy = 0, levelUpRewards = true, visitorRewards = true, regen = true, producers = true } = {}
) {
  const updates = new Map();
  const summaries = [];
  const collectSummaries = [];
  const lootSummaries = [];
  const workSummaries = [];
  const crateSummaries = [];
  const orderSummaries = [];
  const rewardSummaries = [];
  const gains = {};
  let expGained = 0;

  // ---- merges -------------------------------------------------------------
  // A move writes its `keeps` cells (1 output for a 3-merge, 2 for a 5-merge bonus) and empties
  // its `consume` cells. EXP is per output tile, so a bonus merge pays 2x `expReward`.
  const claimed = new Set();
  let normalMerges = 0;
  let bonusMerges = 0;
  for (const mv of moves) {
    const keeps = mv.keeps || [mv.keep];
    const exp = (mv.expReward || 0) * keeps.length;
    for (const k of keeps) {
      updates.set(k.key, filledTile(mv.target, persistedState(bps, mv.target)));
      claimed.add(k.key);
    }
    for (const c of mv.consume) { updates.set(c.key, emptyTile()); claimed.add(c.key); }
    expGained += exp;
    if (mv.bonus) bonusMerges++; else normalMerges++;
    const at = keeps.map((k) => `(${k.row},${k.col})`).join(' + ');
    summaries.push(
      `${mv.blueprint} x${keeps.length + mv.consume.length} -> ${keeps.length > 1 ? `${keeps.length}x ` : ''}${mv.target} @ ${at}  +${exp}exp${mv.bonus ? ' (bonus)' : ''}`
    );
  }

  // ---- collect currency orbs (coins/energy), leftovers only ---------------
  if (collect) {
    for (const v of tiles(models).values()) {
      if (!v || !v.blueprint || claimed.has(v.key)) continue;
      const reward = v.data?.collectable?.reward;
      if (!Array.isArray(reward) || !reward.length) continue;
      const parts = [];
      for (const r of reward) {
        if (!r?.key) continue;
        gains[r.key] = (gains[r.key] || 0) + (r.amount || 0);
        parts.push(`${r.amount} ${r.key}`);
      }
      updates.set(v.key, emptyTile());
      collectSummaries.push(`${v.blueprint} @ (${v.row},${v.col}) -> ${parts.join(' + ')}`);
    }
  }

  // ---- loot finished producers -------------------------------------------
  let harvested = 0;
  if (loot) {
    const inv0 = models.InventoryModel?.json?.data || {};
    const blocked = new Set(updates.keys());
    for (const a of planLoots(models)) {
      const spawn = [];
      const parts = [];
      for (const key of a.loot) {
        if (typeof inv0[key] === 'number') {
          gains[key] = (gains[key] || 0) + 1;
          parts.push(`1 ${key}`);
        } else {
          spawn.push(key);
          parts.push(`+${key}`);
        }
      }
      harvested++;

      const cells = freeCells(models, a.tile).filter((c) => !blocked.has(c.key));
      for (const bp of spawn) {
        const cell = cells.shift();
        if (!cell) { parts.push('(board full!)'); break; }
        blocked.add(cell.key);
        updates.set(cell.key, filledTile(bp, persistedState(bps, bp)));
      }

      if (a.removesObject) {
        updates.set(a.tile.key, emptyTile());
      } else {
        // Tapping a producer's production loot spends one harvest: the tile goes
        // `depleted` and immediately offers its `removeReward` loot. `current` counts
        // down while `max` stays put (HAR: chicken_4 {max:1,current:2} -> {max:1,current:1}),
        // so derive it rather than pinning 1/1 — a 3-harvest producer keeps working.
        const rw = resolveBlueprint(bps, a.tile.blueprint).harvestable?.removeReward;
        const hp = a.tile.data?.hitpoints || {};
        updates.set(a.tile.key, filledTile(a.tile.blueprint, {
          depleted: {},
          hitpoints: {
            max: hp.max ?? 1,
            current: Math.max(1, (hp.current ?? 2) - 1),
            startAsVisible: hp.startAsVisible ?? false,
          },
          lootable: { loot: Array.isArray(rw) ? rw : [], lootingRemovesObject: true },
        }));
      }
      lootSummaries.push(`${a.tile.blueprint} @ (${a.tile.row},${a.tile.col}) -> ${parts.join(', ')}`);
    }
  }

  // ---- finish any resource work whose duration has elapsed ----------------
  let workSpent = 0;
  let workCounters = {};
  const workSpawned = {};
  if (work) {
    const done = buildCompletionUpdates(models, planCompletions(models, { bps }), { bps });
    for (const [k, v] of done.updates) updates.set(k, v);
    workSummaries.push(...done.summaries);

    // a worker freed by a finished step may be re-dispatched immediately
    const plans = planWork(models, { bps, freed: done.freedWorkers, reserve: reserveEnergy })
      .filter((p) => !updates.has(p.tile.key));
    const r = buildWorkUpdates(models, plans, { bps, removeTimerIds: done.removedTimerIds });
    if (r.error) {
      console.log(`  (work skipped: ${r.error})`);
    } else {
      for (const [k, v] of r.updates) updates.set(k, v);
      workSummaries.push(...r.summaries);
      workSpent = r.spent;
      workCounters = r.counters;
    }
    for (const [k, v] of Object.entries(done.spawned)) workSpawned[k] = (workSpawned[k] || 0) + v;
  }

  // ---- orders: complete / collect / start ---------------------------------
  // Runs after work so the TimerModel it edits already contains work's timers.
  let orderSpent = {};
  let ordersTouched = 0;
  let ordersCollected = 0;
  if (orders) {
    const r = buildOrderUpdates(models, {
      bps,
      recipes: recipes || loadRecipes(),
      buildings: buildings || loadBuildings(),
      timerData: updates.get('TimerModel')?.data ?? models.TimerModel?.json?.data,
      blocked: new Set(updates.keys()),
    });
    for (const [k, v] of r.updates) updates.set(k, v);
    orderSummaries.push(...r.summaries);
    orderSpent = r.spent;
    ordersTouched = r.completed + r.collected + r.started;
    ordersCollected = r.collected;
    for (const [k, v] of Object.entries(r.gains)) gains[k] = (gains[k] || 0) + v;
  }

  // ---- tier-4 producers: arm merges, materialise landed cooldowns, repair inert tiles ----
  // Runs after orders so the TimerModel it appends to already carries work + order timers. The
  // producer cooldown is part of the merge itself (a producer with `data == {}` can never merge,
  // loot or produce), so `producers: false` only skips the materialise/repair half.
  const harvestSummaries = [];
  if (bps) {
    const r = buildHarvestUpdates(models, {
      bps,
      moves,
      repair: producers,
      timerData: updates.get('TimerModel')?.data ?? models.TimerModel?.json?.data,
    });
    if (r.error) console.log(`  (producers skipped: ${r.error})`);
    else {
      for (const [k, v] of r.updates) updates.set(k, v);
      harvestSummaries.push(...r.summaries);
    }
  }

  // ---- time-based reloads (regeneration) ----------------------------------
  // The client is the clock: a reload that has run its full duration is credited by the client,
  // not the server. Runs after orders so the TimerModel it edits already carries work + order
  // timers. Like level-up and visitor rewards, the payout is folded into `gains` below so
  // InventoryModel is still written exactly once.
  if (regen) {
    const plans = planRegen(models);
    const r = buildRegenUpdates(models, plans, {
      timerData: updates.get('TimerModel')?.data ?? models.TimerModel?.json?.data,
    });
    if (r.error) console.log(`  (regen skipped: ${r.error})`);
    else {
      for (const [k, v] of r.updates) updates.set(k, v);
      rewardSummaries.push(...r.summaries);
      for (const p of plans) gains[p.key] = (gains[p.key] || 0) + p.amount;
    }
  }

  let cratesOpened = 0;
  if (crates > 0) {
    // final pass, so board changes from the actions above are settled first
    const r = buildCrateUpdates(models, {
      bps, progression, randomness: loadRandomness(), count: crates, blocked: new Set(updates.keys()),
    });
    for (const [k, v] of r.updates) updates.set(k, v);
    crateSummaries.push(...r.summaries);
    cratesOpened = r.opened;
  }

  // ---- daily-challenge / seasonal-pass counters ---------------------------
  // Last, because it sums the actions above. The client bumps these counters for the player's own
  // moves; live the bot *is* the player, so it must bump them itself or the challenges stall no
  // matter how much work it does (the live account sat at `harvest 0/45`, `spend.energy 15/210`).
  // The units are pinned against the captures in lib/daily.js. Empty deltas are a no-op.
  const taskSummaries = [];
  {
    const r = buildTaskUpdates(models, {
      harvest: harvested,
      'spend.energy': workSpent,
      'spend.crates': cratesOpened,
      'order.rewarded': ordersCollected,
    });
    for (const [k, v] of r.updates) updates.set(k, v);
    taskSummaries.push(...r.summaries);
  }

  // ---- InventoryModel: exp/level from merges, currency from collects/loots
  const inv = models.InventoryModel?.json;
  let levelInfo = null;
  if (inv?.data) {
    const next = { ...inv.data };
    let touched = false;
    if (moves.length && typeof inv.data.exp === 'number') {
      levelInfo = applyExp(progression, inv.data.level, inv.data.exp, expGained);
      next.exp = levelInfo.exp;
      next.level = levelInfo.level;
      touched = true;
    }
    for (const [k, amt] of Object.entries(gains)) {
      if (typeof next[k] === 'number') { next[k] += amt; touched = true; }
    }
    for (const [k, amt] of Object.entries(orderSpent)) {
      if (typeof next[k] === 'number') { next[k] -= amt; touched = true; }
    }
    if (workSpent && typeof next.energy === 'number') {
      next.energy -= workSpent;
      touched = true;
    }
    if (cratesOpened && typeof next.crates === 'number') {
      next.crates -= cratesOpened;
      touched = true;
    }

    // ---- level-up rewards: the client applies levels[completed].rewards itself ----
    // Completed level N is `levels[N]` - levelling 13 -> 14 grants `levels[13].rewards`.
    // A multi-level jump grants every level it passed through.
    if (levelUpRewards && levelInfo?.levelUps) {
      for (let L = inv.data.level; L < levelInfo.level; L++) {
        for (const r of levelRewards(progression, L)) {
          if (typeof next[r.key] === 'number') { next[r.key] += r.amount || 0; touched = true; }
          rewardSummaries.push(`level ${L} completed -> +${r.amount} ${r.key}`);
        }
      }
    }

    // ---- visitor ("train") rewards: credit the pending list, then reset the model ----
    if (visitorRewards) {
      const pending = pendingVisitorRewards(models);
      const who = models.VisitorRewardModel?.json?.data?.player || '?';
      for (const r of pending) {
        const credited = typeof next[r.key] === 'number';
        if (credited) { next[r.key] += r.amount || 0; touched = true; }
        rewardSummaries.push(
          `visitor ${who} -> +${r.amount} ${r.key}${credited ? '' : ' (not an inventory counter - skipped)'}`
        );
      }
      if (pending.length) {
        updates.set('VisitorRewardModel', {
          data: { reward: [], player: null },
          version: models.VisitorRewardModel?.json?.version ?? 1,
        });
      }
    }

    if (touched) updates.set('InventoryModel', { data: next, version: inv.version ?? 1 });
  }

  // ---- lifetime counters --------------------------------------------------
  const stats = models.UserStatsModel?.json;
  if ((moves.length || harvested || workSpent || ordersTouched) && stats?.data) {
    updates.set('UserStatsModel', {
      data: {
        ...stats.data,
        totalEarnedXP: (stats.data.totalEarnedXP || 0) + expGained,
        totalNormalMerges: (stats.data.totalNormalMerges || 0) + normalMerges,
        totalBonusMerges: (stats.data.totalBonusMerges || 0) + bonusMerges,
        totalHarvestedItems: (stats.data.totalHarvestedItems || 0) + harvested,
        totalSpentEnergy: (stats.data.totalSpentEnergy || 0) + workSpent,
        ...Object.fromEntries(
          Object.entries(workCounters).map(([k, v]) => [k, (stats.data[k] || 0) + v])
        ),
      },
      version: stats.version ?? 1,
    });
  }

  return {
    updates, expGained, levelInfo, summaries, collectSummaries, lootSummaries, workSummaries,
    crateSummaries, orderSummaries, rewardSummaries, harvestSummaries, taskSummaries, gains, cratesOpened,
    normalMerges, bonusMerges,
  };
}
