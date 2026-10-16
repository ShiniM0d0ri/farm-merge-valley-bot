// lib/regen.js - time-based regeneration ("reloads").
//
// Like every other reward in this game, regeneration is CLIENT-APPLIED: the server never credits
// it on its own. Proof: at 2026-10-16T17:41Z `crates_generator` was already overdue by 670 s while
// the crates counter was still 0, and it stays 0 until a client writes the increment.
//
// `RegenerationServiceModel` holds one entry per generator:
//
//     "crates_10_no_ads": { "timerId": 2258, "lastStartTime": 1792171303471.5 }
//
// The paired `TimerModel` timer is labelled `regenerate_<name>` and carries the duration, so
// "ready" means `now >= lastStartTime + duration`. When the player taps a finished reload the
// client credits the reward, moves `lastStartTime` forward and re-creates the timer - which is
// exactly the write this module reproduces.
//
// Verified against `farm_merge_level_up.har` (see MECHANICS.md section 10):
//
//     save[29]  crates  0 -> 10   regenerate_crates_10_no_ads     +10 crates  / 14400000 ms
//     save[46]  gems  175 -> 180  regenerate_gems_5_no_ads        + 5 gems    / 14400000 ms
//     save[47]  energy 80 -> 85   regenerate_energy_5_no_ads      + 5 energy  / 14400000 ms
//
// Only generators whose reward is a fixed amount on a fixed timer are automated. The ad-gated
// (`*_rv`), premium (`*_premium`) and per-minute stock generators (`*_generator`) are listed in
// `NOT_AUTOMATED` below and deliberately left alone.

/** Generators safe to automate: fixed reward, fixed duration, observed end to end. */
export const GENERATORS = [
  { name: 'crates_10_no_ads', key: 'crates', amount: 10, durationMs: 14400000, reward: '+10 crates / 4 h' },
  { name: 'gems_5_no_ads', key: 'gems', amount: 5, durationMs: 14400000, reward: '+5 gems / 4 h' },
  { name: 'energy_5_no_ads', key: 'energy', amount: 5, durationMs: 14400000, reward: '+5 energy / 4 h' },
];

/**
 * Present in RegenerationServiceModel but NOT automated, with the reason:
 *  - `*_rv` / `*_premium` are ad- and purchase-gated; farming them is not "playing the game".
 *  - `*_generator` are passive per-minute stock refills (+1 crate / 5 min, +1 energy / 3 min).
 *    Their ceiling lives in the obfuscated client and was never observed being hit
 *    (crates peaked at 175, energy at 185), so a catch-up grant after any idle period would be
 *    unbounded. Left for a future capture that shows the cap.
 */
export const NOT_AUTOMATED = [
  { name: 'crates_generator', key: 'crates', amount: 1, durationMs: 300000, reason: 'per-minute stock refill, ceiling unknown' },
  { name: 'energy_generator', key: 'energy', amount: 1, durationMs: 180000, reason: 'per-minute stock refill, ceiling unknown' },
  { name: 'tle_energy_generator', key: 'time_limited_event_energy', amount: 1, durationMs: 180000, reason: 'event-only refill' },
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
export function planRegen(models, { now = Date.now(), maxCycles = 1, table = GENERATORS } = {}) {
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

  out.sort((a, b) => b.overdueMs - a.overdueMs);
  return out;
}

/**
 * Write the collected reloads: reward goes to the caller (the solver folds it into InventoryModel
 * once, with every other counter change), this only advances the service model and re-arms the
 * `regenerate_<name>` timer.
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
