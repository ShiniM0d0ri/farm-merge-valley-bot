// lib/regen.js - time-based regeneration: reloads and passive stock refills.
//
// Like every other reward in this game, regeneration is CLIENT-APPLIED: the server never credits
// it on its own. Proof: at 2026-10-16T17:41Z `crates_generator` was already overdue by 670 s while
// the crates counter was still 0, and it stays 0 until a client writes the increment.
//
// `RegenerationServiceModel` holds one entry per generator:
//
//     "crates_10_no_ads": { "timerId": 2258, "lastStartTime": 1792171303471.5 }
//
// Two different kinds of generator live in there:
//
//   * RELOADS - the ad-free `*_no_ads` refills. The paired `TimerModel` timer is labelled
//     `regenerate_<name>` and carries the duration, so "ready" means `now >= lastStartTime +
//     duration`. When the player taps a finished reload the client credits the reward, moves
//     `lastStartTime` forward and re-creates the timer - which is exactly the write `GENERATORS`
//     reproduces.
//
//   * STOCK REFILLS - `crates_generator` / `energy_generator`. Nobody taps these: the client tops
//     the counter up as time passes and stalls once the counter reaches the generator's ceiling.
//     There is no timer (`timerId` stays `null`) and the ceiling + rate are not in the obfuscated
//     client at all - they are in the `config` jsonpack, which is what `PASSIVE` below reads.
//
// Verified against `farm_merge_level_up.har` (see MECHANICS.md section 10):
//
//     save[29]  crates  0 -> 10   regenerate_crates_10_no_ads     +10 crates  / 14400000 ms
//     save[46]  gems  175 -> 180  regenerate_gems_5_no_ads        + 5 gems    / 14400000 ms
//     save[47]  energy 80 -> 85   regenerate_energy_5_no_ads      + 5 energy  / 14400000 ms
//
// Only generators whose reward is a fixed amount on a fixed timer are automated. The ad-gated
// (`*_rv`), premium (`*_premium`) and event-only generators are listed in `NOT_AUTOMATED` below and
// deliberately left alone.
import fs from 'node:fs';
import { cfgPath } from './env.js';

/** Generators safe to automate: fixed reward, fixed duration, observed end to end. */
export const GENERATORS = [
  { name: 'crates_10_no_ads', key: 'crates', amount: 10, durationMs: 14400000, reward: '+10 crates / 4 h' },
  { name: 'gems_5_no_ads', key: 'gems', amount: 5, durationMs: 14400000, reward: '+5 gems / 4 h' },
  { name: 'energy_5_no_ads', key: 'energy', amount: 5, durationMs: 14400000, reward: '+5 energy / 4 h' },
];

/**
 * Passive stock refills: no timer, no tap - the client tops the counter up as time passes and stops
 * at the generator's ceiling. Both numbers live in the `config` jsonpack (`npm run config`):
 *
 *   crate_regeneration_config  { MAX_AMOUNT: 40, AMOUNT_PER_INTERVAL: 5, SPAWN_INTERVAL: 300 }
 *   energy_regeneration_config { MAX_AMOUNT: 50, AMOUNT_PER_INTERVAL: 1, SPAWN_INTERVAL: 180 }
 *
 * `SPAWN_INTERVAL` is in seconds and lines up exactly with the `regenerate_<name>` duration the
 * client writes (300000 ms / 180000 ms), which is what pins each config to its generator.
 */
export const PASSIVE = [
  { name: 'crates_generator', key: 'crates', config: 'crate_regeneration_config' },
  { name: 'energy_generator', key: 'energy', config: 'energy_regeneration_config' },
];

/** Path of the `config` jsonpack - the pack that carries the two `*_regeneration_config` entries. */
export const REGEN_CFG_PATH = process.env.FMV_CONFIG_PACK || cfgPath('config_jsonpack.json');

let ceilingCache = null;
let warnedMissingCeilings = false;

/**
 * Ceilings and rates for the passive refills, read from the `config` jsonpack.
 *
 * Returns `null` when the pack is missing (a clone that never ran `npm run config`). The caller then
 * leaves the refills alone instead of guessing a ceiling: an idle account has a whole backlog of
 * elapsed intervals banked, and granting it without knowing where the counter stops is exactly the
 * unbounded write this used to avoid.
 */
export function loadCeilings(path = REGEN_CFG_PATH) {
  if (ceilingCache?.path === path) return ceilingCache.table;
  let table = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
    table = {};
    for (const g of PASSIVE) {
      const c = cfg[g.config];
      if (!(c?.MAX_AMOUNT > 0) || !(c?.AMOUNT_PER_INTERVAL > 0) || !(c?.SPAWN_INTERVAL > 0)) continue;
      table[g.name] = { max: c.MAX_AMOUNT, per: c.AMOUNT_PER_INTERVAL, intervalMs: c.SPAWN_INTERVAL * 1000 };
    }
    if (!Object.keys(table).length) table = null;
  } catch {
    table = null;
  }
  if (!table && !warnedMissingCeilings) {
    warnedMissingCeilings = true;
    console.warn(`(passive stock refills disabled: no ${path} - run "npm run config")`);
  }
  ceilingCache = { path, table };
  return table;
}

/**
 * Plan the passive stock refills, as `kind: 'passive'` plans.
 *
 * The client's rule, reconstructed from the live account on 2026-10-16:
 *
 *   if (current >= ceiling) { do nothing at all }
 *   else { pending = floor((now - lastStartTime) / interval);
 *          current += min(pending * per, ceiling - current);
 *          lastStartTime = now; arm(regenerate_<name>, interval) }
 *
 * The "do nothing at all" arm is the observed part: the counter read **60** (above the 40 ceiling)
 * while `crates_generator.lastStartTime` stayed **4h19m** old, so a parked counter neither grants nor
 * advances the clock - the whole backlog is still banked the moment the counter drops again. That is
 * what the player sees as "40/40 instantly refilled" right after the bot opens a pile of crates.
 *
 * The rest is the client's own write, read off the live account at 2026-10-16T21:48:43Z: it credited
 * the whole backlog (crates 0 -> 40, i.e. 51 accrued intervals clamped to the ceiling), set
 * `crates_generator.lastStartTime = now`, and armed `regenerate_crates_generator`
 * (`{duration: 300000, timeSource: 'server'}`, `timerId` pointing at it). So the clock **resets to
 * now** rather than advancing by the intervals credited - the sub-interval remainder is discarded,
 * like time parked at the ceiling. The grant is clamped to the ceiling instead of dropped when an
 * interval does not fit, or crates sitting at 38 of 40 would stall the generator forever.
 */
export function planPassive(models, { now = Date.now(), ceilings } = {}) {
  const regen = models.RegenerationServiceModel?.json?.data;
  const inv = models.InventoryModel?.json?.data || {};
  if (!regen) return [];
  const table = ceilings === undefined ? loadCeilings() : ceilings;
  if (!table) return [];

  const out = [];
  for (const gen of PASSIVE) {
    const c = table[gen.name];
    const entry = regen[gen.name];
    if (!c || !entry?.lastStartTime) continue;
    const current = typeof inv[gen.key] === 'number' ? inv[gen.key] : null;
    if (current === null) continue;
    // parked at (or above) the ceiling: the generator is stalled and the clock is not touched
    if (current >= c.max) continue;

    const pending = Math.floor((now - entry.lastStartTime) / c.intervalMs);
    if (pending < 1) continue;
    const amount = Math.min(pending * c.per, c.max - current);
    if (amount < 1) continue;
    const spent = Math.ceil(amount / c.per);

    out.push({
      kind: 'passive',
      name: gen.name,
      key: gen.key,
      amount,
      spent,
      due: pending,
      pending,
      wasted: pending - spent,
      ceiling: c.max,
      per: c.per,
      durationMs: c.intervalMs,
      overdueMs: now - entry.lastStartTime - pending * c.intervalMs,
      lastStartTime: entry.lastStartTime,
      // the client's own write: the clock resets to now, so the leftover sub-interval is dropped
      nextStartTime: now,
      why: 'generator',
      current,
      stockBefore: null,
      reward: `+${c.per} ${gen.key} / ${Math.round(c.intervalMs / 60000)} min, ceiling ${c.max}`,
    });
  }
  return out;
}

/**
 * Present in RegenerationServiceModel but NOT automated, with the reason:
 *  - `*_rv` / `*_premium` are ad- and purchase-gated; farming them is not "playing the game".
 *  - `tle_energy_generator` is event-only and has no `*_regeneration_config` entry, so its ceiling
 *    is still unknown (see `event_energy_5_no_ads` below for the 150 the counter sits at).
 */
export const NOT_AUTOMATED = [
  { name: 'tle_energy_generator', key: 'time_limited_event_energy', amount: 1, durationMs: 180000, reason: 'event-only refill, no regeneration config so the ceiling is unknown' },
  {
    name: 'event_energy_5_no_ads', key: 'time_limited_event_energy', amount: 5, durationMs: 14400000,
    reason: 'live at stock 1 (available) but `time_limited_event_energy` sits at exactly 150 in every '
      + 'save of both HARs, so 150 looks like a hard cap - granting would write a value the game clamps',
  },
  { name: 'crates_10_rv', key: 'crates', amount: 10, durationMs: 14400000, reason: 'ad-gated' },
  { name: 'energy_5_rv', key: 'energy', amount: 5, durationMs: 14400000, reason: 'ad-gated' },
  { name: 'gems_5_rv', key: 'gems', amount: 5, durationMs: 14400000, reason: 'ad-gated' },
  { name: 'crates_10_premium', key: 'crates', amount: 10, durationMs: 14400000, reason: 'premium-gated' },
  { name: 'energy_5_premium', key: 'energy', amount: 5, durationMs: 14400000, reason: 'premium-gated' },
  { name: 'gems_5_premium', key: 'gems', amount: 5, durationMs: 14400000, reason: 'premium-gated' },
];

/** Duration the client actually wrote on the paired `regenerate_<name>` timer, if it is present. */
function timerDuration(timers, name) {
  const t = (timers || []).find((x) => x.label === `regenerate_${name}`);
  return t?.duration ?? null;
}

/**
 * `MarketplaceModel.data.stock` is the authoritative "is a refill available" counter, keyed by the
 * same generator names. The HAR shows it decrementing exactly when a refill is collected:
 *
 *   gems_5_no_ads 1 -> 0   (same save as `gems 175 -> 180`)
 *   energy_5_no_ads 1 -> 0 (same save as `energy 80 -> 85`)
 *   crates_10_no_ads 0     (the save that collected `crates 0 -> 10`)
 *
 * The ad/premium variants bank up to 5; the ad-free ones hold a single refill. So it must be
 * decremented with the reward, or the client keeps offering a refill the timer has already spent.
 */
function stockOf(models) {
  return models.MarketplaceModel?.json?.data?.stock;
}

/**
 * Which generators are due right now.
 *
 * `cycles` is clamped to `maxCycles` (default 1) so one save never credits more than one reload
 * per generator: a long idle period drains one cycle per save instead of landing as a single
 * enormous write. `lastStartTime` advances by exactly the collected cycles, so the backlog is
 * preserved rather than discarded.
 */
export function planRegen(models, { now = Date.now(), maxCycles = 1, table = GENERATORS, passive = true, ceilings } = {}) {
  const regen = models.RegenerationServiceModel?.json?.data;
  if (!regen) return [];
  const timers = models.TimerModel?.json?.data?.timers;
  const inv = models.InventoryModel?.json?.data || {};
  const stock = stockOf(models);
  const out = [];

  for (const gen of table) {
    const entry = regen[gen.name];
    if (!entry || !entry.lastStartTime) continue;
    const durationMs = timerDuration(timers, gen.name) ?? gen.durationMs;
    if (!durationMs) continue;

    const elapsed = now - entry.lastStartTime;
    const due = Math.floor(elapsed / durationMs);
    const timerDue = due >= 1;

    // `stock` is the authority on availability: 1 = the game is currently offering this refill.
    // The HAR proves it is not just a mirror of the timer - `gems_5_no_ads` was collected only
    // 65 min after its `lastStartTime` because its stock was already banked at 1, and the live
    // account shows all three at stock 0 while their 4 h clocks run, and `event_energy_5_no_ads`
    // sitting at stock 1 with no timer at all.
    //
    // So: collect if the stock is banked, OR if the timer says the refill has landed (which is the
    // only signal for a refill that has not been written yet). Neither alone is sufficient.
    const held = typeof stock?.[gen.name] === 'number' ? stock[gen.name] : null;
    const banked = held !== null && held >= 1;
    if (!timerDue && !banked) continue;

    const cycles = timerDue ? Math.min(due, maxCycles) : 1;
    out.push({
      kind: 'reload',
      name: gen.name,
      key: gen.key,
      amount: cycles * gen.amount,
      cycles,
      due,
      durationMs,
      overdueMs: elapsed - cycles * durationMs,
      lastStartTime: entry.lastStartTime,
      // A banked refill resets the clock to now. Keeping the stale `lastStart + duration` would be
      // in the past, so the timer branch would fire again on the very next save - a runaway.
      nextStartTime: banked && !timerDue ? now : entry.lastStartTime + cycles * durationMs,
      why: banked && !timerDue ? 'stock' : 'timer',
      current: typeof inv[gen.key] === 'number' ? inv[gen.key] : null,
      stockBefore: held,
      reward: gen.reward,
    });
  }

  // Passive stock refills ride along on the same plan, as `kind: 'passive'` entries.
  if (passive) out.push(...planPassive(models, { now, ceilings }));

  out.sort((a, b) => b.overdueMs - a.overdueMs);
  return out;
}

/**
 * Write the collected regeneration: reward goes to the caller (the solver folds it into
 * InventoryModel once, with every other counter change), this advances the service model and re-arms
 * the `regenerate_<name>` timer.
 *
 * Both kinds write the same timer shape - the live account arms `regenerate_crates_generator` with
 * `duration: 300000` the same way it arms a 4 h reload. A passive refill only differs in what it
 * does *not* touch: no MarketplaceModel stock is spent (nobody tapped anything), and the summary
 * says so.
 */
export function buildRegenUpdates(models, plans, { timerData, now = Date.now() } = {}) {
  const updates = new Map();
  const summaries = [];
  if (!plans.length) return { updates, summaries };

  const tm = models.TimerModel?.json;
  const data = timerData ?? tm?.data;
  if (!data || !Array.isArray(data.timers)) return { updates, summaries, error: 'no TimerModel available' };

  const timers = [...data.timers];
  let nextTimerId = data.nextTimerId ?? 0;

  const svc = models.RegenerationServiceModel?.json;
  const regen = { ...(svc?.data || {}) };

  // MarketplaceModel stock decrement, in the same save the client does it
  const mp = models.MarketplaceModel?.json;
  const stock = stockOf(models);
  let nextStock = null;

  for (const p of plans) {
    const id = nextTimerId++;
    timers.push({
      id, started: now, state: 'ACTIVE', label: `regenerate_${p.name}`, duration: p.durationMs, timeSource: 'server',
    });
    regen[p.name] = { ...regen[p.name], timerId: id, lastStartTime: p.nextStartTime };

    if (p.kind === 'passive') {
      summaries.push(
        `stock refill ${p.name}: +${p.amount} ${p.key} [${p.why}]` +
          ` (${p.spent}/${p.pending} interval(s) up to the ${p.ceiling} ceiling)` +
          (p.wasted ? `, ${p.wasted} lost at the ceiling` : '') +
          `  next in ${Math.round(p.durationMs / 60000)} min`
      );
      continue;
    }

    if (p.stockBefore !== null && stock) {
      nextStock = nextStock || { ...stock };
      // collect consumes a refill; with the stock already at 0 we consumed the one we just refilled,
      // which is why the value always lands on 0 either way
      nextStock[p.name] = Math.max(0, p.stockBefore - 1);
    }
    summaries.push(
      `reload ${p.name}: +${p.amount} ${p.key} [${p.why}]` +
        (p.stockBefore !== null ? ` (stock ${p.stockBefore} -> ${Math.max(0, p.stockBefore - 1)})` : '') +
        (p.due > p.cycles ? ` (${p.due - p.cycles} more queued)` : '') +
        `  next in ${Math.round(p.durationMs / 60000)} min`
    );
  }

  updates.set('TimerModel', { data: { ...data, timers, nextTimerId }, version: tm?.version ?? 1 });
  updates.set('RegenerationServiceModel', { data: regen, version: svc?.version ?? 1 });
  if (nextStock) updates.set('MarketplaceModel', { data: { ...mp?.data, stock: nextStock }, version: mp?.version ?? 1 });
  return { updates, summaries };
}
