// Resource work: send a worker to a tree / rock / toolbox tile.
//
// Decoded from HAR SAVE [27] (rock_small @ 60:62, max 3):
//   before: {hitpoints:{max:3,current:2}, resourceGate:{cost:[{energy,10}],workers:1,duration:60}}
//   after : {hitpoints:{max:3,current:1}, workerData:{id:1}, cooldown:{timerId:2165}}
// i.e. a dispatch removes the gate, records the worker and starts a cooldown timer.
// The *step* rewards spawn when the work completes (`gate.duration` seconds later);
// the final step instead leaves a `lootable` on the tile (SAVE [33]).
//
// Step tables live in blueprints: components.mapSource.steps["1".."n"] = {cost, duration, rewards},
// and the persisted gate is a verbatim copy of the current step:
//   stepIndex = hitpoints.max - hitpoints.current + 1
'use strict';
import { tiles, freeCells, filledTile } from './board.js';
import { resolveBlueprint, persistedState } from './blueprints.js';

// The cooldown timer is a *separate*, longer-lived lock than the work itself.
// Only one sample exists: work duration 180s -> cooldown 90000ms (i.e. duration/2).
// It only gates re-dispatching the same tile, so an inexact value is low-impact.
export const COOLDOWN_MS = (durationSeconds) => Math.round(durationSeconds * 1000 * 0.5);

/** The step a tile is about to perform, per its persisted gate. */
export function stepForTile(bps, tile) {
  const hp = tile?.data?.hitpoints;
  if (!hp || typeof hp.max !== 'number' || typeof hp.current !== 'number') return null;
  const steps = resolveBlueprint(bps, tile.blueprint).mapSource?.steps;
  if (!steps) return null;
  const index = hp.max - hp.current + 1;
  const step = steps[String(index)];
  if (!step) return null;
  return { index, step };
}

/** Worker ids currently assigned to a tile. */
export function busyWorkerIds(models) {
  const ids = new Set();
  for (const v of tiles(models).values()) {
    const id = v?.data?.workerData?.id;
    if (typeof id === 'number') ids.add(id);
  }
  return ids;
}

/**
 * Tiles that are ready to be worked by a free worker.
 * Only picks gates that agree exactly with the config step table, so a tile whose
 * persisted state we don't understand is never touched.
 */
export function planWork(models, { bps, max, freed, reserve = 0 } = {}) {
  const workers = models.GameWorkersModel?.json?.data?.workers || [];
  const busy = busyWorkerIds(models);
  const free = workers
    .filter((w) => !busy.has(w.id) || freed?.has(w.id))
    .map((w) => w.id);
  if (!free.length) return [];
  const limit = Math.min(max ?? free.length, free.length);
  const energy = models.InventoryModel?.json?.data?.energy ?? 0;
  // `reserve` keeps that much energy untouched so a parallel-playing human still has some.
  const budget = energy - Math.max(0, reserve);

  const out = [];
  let spent = 0;
  for (const v of tiles(models).values()) {
    if (out.length >= limit) break;
    if (!v?.blueprint || !v.data?.resourceGate) continue;
    if (v.data.workerData || v.data.cooldown) continue;
    const s = stepForTile(bps, v);
    if (!s || !s.step) continue;

    const gate = v.data.resourceGate;
    const amount = gate.cost?.[0]?.amount;
    // refuse anything the config doesn't corroborate
    if (amount !== s.step.cost) continue;
    if (gate.duration !== s.step.duration) continue;
    if (amount + spent > budget) continue;

    out.push({ tile: v, stepIndex: s.index, step: s.step, workerId: free[0], cost: amount });
    spent += amount;
  }
  return out;
}

/**
 * Apply dispatches. Returns the model writes plus bookkeeping.
 * Reward spawning is deliberately NOT done here: the game materialises the
 * finished step itself once `duration` elapses, exactly as it does for a real player.
 */
export function buildWorkUpdates(models, plans, { bps, removeTimerIds } = {}) {
  const updates = new Map();
  const summaries = [];
  const counters = {};
  let spent = 0;

  const tm = models.TimerModel?.json;
  const data = tm?.data;
  const needsTimers = plans.length || removeTimerIds?.size;
  if (needsTimers && (!data || !Array.isArray(data.timers))) {
    return { updates, summaries, counters, spent: 0, error: 'no TimerModel available' };
  }
  const drop = removeTimerIds || new Set();
  let timers = data ? data.timers.filter((t) => !drop.has(t.id)) : [];
  let nextTimerId = data?.nextTimerId ?? 0;
  const now = Date.now();

  for (const p of plans) {
    const t = p.tile;
    const cd = COOLDOWN_MS(p.step.duration);
    const timerId = nextTimerId++;

    timers.push({
      id: timerId,
      started: now,
      state: 'ACTIVE',
      label: `MapSourceCooldown:${t.row},${t.col}`,
      duration: cd,
      timeSource: 'server',
    });

    updates.set(t.key, {
      data: {
        state: {
          blueprint: t.blueprint,
          data: {
            hitpoints: t.data.hitpoints,
            workerData: { id: p.workerId },
            cooldown: { timerId },
          },
        },
      },
      version: 1,
    });

    spent += p.cost;
    const type = resolveBlueprint(bps, t.blueprint).mapSource?.type;
    if (type === 'rock') counters.totalMinedRocks = (counters.totalMinedRocks || 0) + 1;
    if (type === 'tree') counters.totalChoppedTrees = (counters.totalChoppedTrees || 0) + 1;

    summaries.push(
      `worker ${p.workerId} -> ${t.blueprint} @ (${t.row},${t.col}) step ${p.stepIndex}/${t.data.hitpoints.max}` +
        `  -${p.cost} energy  ${p.step.duration}s work  cooldown ${cd / 1000}s`
    );
  }

  if (needsTimers) {
    updates.set('TimerModel', {
      data: { ...data, timers, nextTimerId },
      version: tm.version ?? 1,
    });
  }

  return { updates, summaries, counters, spent };
}

/** In-flight work whose `duration` has genuinely elapsed. */
export function planCompletions(models, { bps } = {}) {
  const tm = models.TimerModel?.json?.data;
  const byId = new Map((tm?.timers || []).map((t) => [t.id, t]));
  const now = Date.now();
  const out = [];
  for (const v of tiles(models).values()) {
    if (!v?.blueprint || !v.data?.workerData || !v.data?.cooldown) continue;
    const s = stepForTile(bps, v);
    if (!s?.step) continue;
    const timer = byId.get(v.data.cooldown.timerId) || null;
    const due = timer ? timer.started + s.step.duration * 1000 : null;
    out.push({
      tile: v,
      stepIndex: s.index,
      step: s.step,
      timer,
      due,
      ready: due !== null && now >= due,
    });
  }
  return out;
}

/**
 * Apply finished work. A non-final step spawns its rewards as tiles and installs
 * the next gate; the final step leaves a `lootable` on the tile (HAR SAVE [33]).
 * The tile's cooldown timer is cleared either way.
 */
export function buildCompletionUpdates(models, plans, { bps } = {}) {
  const updates = new Map();
  const summaries = [];
  const spawned = {};
  const freedWorkers = new Set();
  const removedTimerIds = new Set();

  const blocked = new Set(updates.keys());
  for (const p of plans) {
    if (!p.ready) continue;
    const t = p.tile;
    const hp = t.data.hitpoints;
    if (p.timer) removedTimerIds.add(p.timer.id);
    if (typeof t.data.workerData?.id === 'number') freedWorkers.add(t.data.workerData.id);

    const finalStep = hp.current <= 1;
    const rewards = Array.isArray(p.step.rewards) ? p.step.rewards : [];

    if (finalStep) {
      updates.set(t.key, {
        data: {
          state: {
            blueprint: t.blueprint,
            data: {
              hitpoints: hp,
              lootable: { loot: rewards, lootingRemovesObject: true },
            },
          },
        },
        version: 1,
      });
      summaries.push(
        `${t.blueprint} @ (${t.row},${t.col}) step ${p.stepIndex} done -> lootable [${rewards.join(', ')}]`
      );
      continue;
    }

    const current = hp.current - 1;
    const nextIndex = hp.max - current + 1;
    const next = resolveBlueprint(bps, t.blueprint).mapSource?.steps?.[String(nextIndex)];
    if (!next) continue;

    updates.set(t.key, {
      data: {
        state: {
          blueprint: t.blueprint,
          data: {
            hitpoints: { ...hp, current },
            resourceGate: {
              cost: [{ key: 'energy', amount: next.cost }],
              workers: 1,
              duration: next.duration,
            },
          },
        },
      },
      version: 1,
    });

    const cells = freeCells(models, t).filter((c) => !blocked.has(c.key));
    const parts = [];
    for (const bp of rewards) {
      const cell = cells.shift();
      if (!cell) { parts.push('(board full!)'); break; }
      blocked.add(cell.key);
      updates.set(cell.key, filledTile(bp, persistedState(bps, bp)));
      parts.push(bp);
    }
    summaries.push(
      `${t.blueprint} @ (${t.row},${t.col}) step ${p.stepIndex} done -> step ${nextIndex} gate` +
        (parts.length ? `  +[${parts.join(', ')}]` : '')
    );
    for (const bp of rewards) spawned[bp] = (spawned[bp] || 0) + 1;
  }

  return { updates, summaries, spawned, freedWorkers, removedTimerIds };
}
