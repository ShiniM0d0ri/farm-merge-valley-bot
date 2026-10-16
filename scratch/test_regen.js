// scratch/test_regen.js - verify the time-based regeneration planner against farm_merge_level_up.har.
//
// Replays the three reload collects the HAR actually contains:
//   save[29]  crates  0 -> 10   regenerate_crates_10_no_ads   (stock 0 -> 0)
//   save[46]  gems  175 -> 180  regenerate_gems_5_no_ads      (stock 1 -> 0)
//   save[47]  energy 80 -> 85   regenerate_energy_5_no_ads    (stock 1 -> 0)
//
// Availability has TWO independent signals and neither alone is sufficient:
//   - `MarketplaceModel.data.stock[x] >= 1` - the refill is banked and the game is offering it.
//     The HAR proves this is not a mirror of the timer: gems was collected only 65 min after its
//     `lastStartTime`, because the stock was already banked.
//   - `lastStartTime + duration <= now` - the refill has landed but has not been written yet.
//     Live, all three read stock 0 while their 4 h clocks run, so the timer is the only signal.
//
// Section 5 covers the PASSIVE stock refills (`crates_generator` / `energy_generator`), whose
// ceiling and rate come from the `config` jsonpack - the live 40/40 the player saw is section 5's
// first fixture.
import { planRegen, buildRegenUpdates, planPassive, loadCeilings, GENERATORS, PASSIVE, NOT_AUTOMATED } from '../lib/regen.js';
import { buildUpdates } from '../lib/solver.js';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
  if (!cond) fails++;
};

const now = Date.now();
const H = 3600000;
const MIN = 60000;
const DUR = 14400000;
const tRegen = (name, dur) => ({ id: 0, started: 0, state: 'ACTIVE', label: `regenerate_${name}`, duration: dur, timeSource: 'server' });

// CRATES: timer landed, stock 0 - the exact live/HAR situation. TIMER path.
// GEMS:   clock has NOT elapsed but the stock is banked - the HAR's save[46] situation. STOCK path.
// ENERGY: clock landed AND banked, 3 cycles deep - exercises the clamp.
const har = () => ({
  RegenerationServiceModel: {
    key: 'RegenerationServiceModel',
    json: {
      data: {
        crates_10_no_ads: { timerId: null, lastStartTime: now - DUR - 60000 },
        gems_5_no_ads: { timerId: 2263, lastStartTime: now - 1 * H },
        energy_5_no_ads: { timerId: 2264, lastStartTime: now - 3 * DUR - 30000 },
        // gated / non-automated entries: must be ignored
        crates_10_rv: { timerId: null, lastStartTime: now - 5 * DUR },
        gems_5_premium: { timerId: null, lastStartTime: now - 5 * DUR },
        event_energy_5_no_ads: { timerId: null, lastStartTime: now - 5 * DUR },
        // passive stock refills: parked on a clock that has not produced an interval yet, so the
        // reload section stays about reloads (section 5 drives them properly)
        crates_generator: { timerId: 2268, lastStartTime: now - 1000 },
        energy_generator: { timerId: null, lastStartTime: now - 1000 },
        mp_flash_deals: { timerId: 2196, lastStartTime: now - 3 * H },
      },
      version: 4,
    },
  },
  TimerModel: {
    key: 'TimerModel',
    json: {
      data: {
        timers: [
          tRegen('gems_5_no_ads', DUR),
          tRegen('energy_5_no_ads', DUR),
          tRegen('crates_generator', 300000),
          { id: 2196, started: 0, state: 'ACTIVE', label: 'mp_flash_deals', duration: 1, timeSource: 'server' },
        ],
        nextTimerId: 2273,
      },
      version: 1,
    },
  },
  InventoryModel: {
    key: 'InventoryModel',
    json: { data: { level: 13, exp: 6614, coins: 294, gems: 175, energy: 80, crates: 0 }, version: 1 },
  },
  MarketplaceModel: {
    key: 'MarketplaceModel',
    json: {
      data: {
        stock: {
          gems_5_rv: 5, energy_5_rv: 5, crates_10_rv: 5,
          gems_5_no_ads: 1, energy_5_no_ads: 1, crates_10_no_ads: 0,
          flash_deal_key: 2, flash_deal_chest: 2,
        },
        flashDeals: { some: 'unrelated state' },
      },
      version: 3,
    },
  },
});

// --- 1. planning ---------------------------------------------------------------
const plans = planRegen(har(), { now });
const byName = Object.fromEntries(plans.map((p) => [p.name, p]));

check('three reloads are collectable', plans.length === 3, plans.map((p) => `${p.name}/${p.why}`).join(', ') || 'none');
check('crates via the TIMER path (stock 0): +10 crates',
  byName.crates_10_no_ads?.amount === 10 && byName.crates_10_no_ads?.why === 'timer' && byName.crates_10_no_ads?.stockBefore === 0);
check('gems via the STOCK path (banked, clock not elapsed): +5 gems',
  byName.gems_5_no_ads?.amount === 5 && byName.gems_5_no_ads?.why === 'stock' && byName.gems_5_no_ads?.stockBefore === 1);
check('energy: +5 energy, timer path wins when the clock has also landed',
  byName.energy_5_no_ads?.amount === 5 && byName.energy_5_no_ads?.why === 'timer');
check('3-deep energy backlog clamped to 1 cycle, due reported as 3',
  byName.energy_5_no_ads?.cycles === 1 && byName.energy_5_no_ads?.due === 3);
check('maxCycles=3 drains the backlog', planRegen(har(), { now, maxCycles: 3 }).find((p) => p.name === 'energy_5_no_ads')?.amount === 15);
check('timer path preserves the cycle (nextStart = lastStart + 1 duration)',
  byName.crates_10_no_ads?.nextStartTime === har().RegenerationServiceModel.json.data.crates_10_no_ads.lastStartTime + DUR);
check('stock path resets the clock to now (no runaway)', byName.gems_5_no_ads?.nextStartTime === now);
check('ad-gated / premium / event / per-minute generators ignored',
  !byName.crates_10_rv && !byName.gems_5_premium && !byName.event_energy_5_no_ads &&
  !byName.crates_generator && !byName.energy_generator);

const renamed = har();
renamed.TimerModel.json.data.timers = [tRegen('crates_10_no_ads', 3600000)];
check('duration taken from the regenerate_<name> timer when present',
  planRegen(renamed, { now }).find((p) => p.name === 'crates_10_no_ads')?.durationMs === 3600000);

// nothing due, nothing banked -> nothing planned, nothing written
const idle = har();
for (const v of Object.values(idle.RegenerationServiceModel.json.data)) v.lastStartTime = now - 1000;
for (const k of Object.keys(idle.MarketplaceModel.json.data.stock)) idle.MarketplaceModel.json.data.stock[k] = 0;
check('nothing due and nothing banked -> no plans', planRegen(idle, { now }).length === 0);
check('nothing due and nothing banked -> no updates', buildRegenUpdates(idle, [], {}).updates.size === 0);

// stock 0 with a clock that has NOT elapsed -> nothing available
const waiting = har();
waiting.RegenerationServiceModel.json.data.crates_10_no_ads.lastStartTime = now - 1 * H;
check('stock 0 + clock not elapsed -> not collectable',
  !planRegen(waiting, { now }).find((p) => p.name === 'crates_10_no_ads'));

// --- 2. the write --------------------------------------------------------------
const m = har();
const r = buildRegenUpdates(m, plans, { timerData: m.TimerModel.json.data, now });
const timers = r.updates.get('TimerModel').data.timers;
const svc = r.updates.get('RegenerationServiceModel').data;
const mp = r.updates.get('MarketplaceModel');
const newT = timers.filter((t) => t.started === now && t.duration === DUR);

check('three models written', r.updates.has('TimerModel') && r.updates.has('RegenerationServiceModel') && r.updates.has('MarketplaceModel'));
check('three reload timers re-armed', newT.length === 3, newT.map((t) => t.label).join(','));
check('timer labels are regenerate_<name>', newT.every((t) => t.label.startsWith('regenerate_')));
check('nextTimerId advanced by 3', r.updates.get('TimerModel').data.nextTimerId === 2276);
check('timerId re-pointed at the new timer', svc.crates_10_no_ads.timerId === newT.find((t) => t.label === 'regenerate_crates_10_no_ads').id);
check('timer path advanced lastStartTime', svc.crates_10_no_ads.lastStartTime === byName.crates_10_no_ads.nextStartTime);
check('stock path set lastStartTime to now', svc.gems_5_no_ads.lastStartTime === now);
check('untouched generators byte-identical',
  JSON.stringify(svc.crates_generator) === JSON.stringify(har().RegenerationServiceModel.json.data.crates_generator) &&
  JSON.stringify(svc.mp_flash_deals) === JSON.stringify(har().RegenerationServiceModel.json.data.mp_flash_deals));
check('original timers preserved', timers.length === 4 + 3);
check('version preserved', r.updates.get('RegenerationServiceModel').version === 4);

check('stock spent: banked entries land on 0, already-0 stays 0',
  mp?.data?.stock?.crates_10_no_ads === 0 && mp?.data?.stock?.gems_5_no_ads === 0 && mp?.data?.stock?.energy_5_no_ads === 0);
check('stock of untouched generators preserved',
  mp?.data?.stock?.gems_5_rv === 5 && mp?.data?.stock?.flash_deal_key === 2 && mp?.data?.stock?.crates_10_rv === 5);
check('unrelated MarketplaceModel state preserved', mp?.data?.flashDeals?.some === 'unrelated state' && mp?.version === 3);
check('summary names the amount and the signal',
  r.summaries.some((s) => s.includes('reload crates_10_no_ads: +10 crates [timer]')) &&
  r.summaries.some((s) => s.includes('reload gems_5_no_ads: +5 gems [stock]')));
check('summary shows the stock transition', r.summaries.some((s) => s.includes('stock 1 -> 0')), r.summaries.join(' | '));

// --- 2b. idempotence: re-planning the written state must plan nothing -----------
// This is the runaway guard: a collect that leaves a stale clock in the past would fire forever.
const noBacklog = har();
noBacklog.RegenerationServiceModel.json.data.energy_5_no_ads.lastStartTime = now - DUR - 30000;
const p1 = planRegen(noBacklog, { now });
const w1 = buildRegenUpdates(noBacklog, p1, { timerData: noBacklog.TimerModel.json.data, now });
const applied = JSON.parse(JSON.stringify(noBacklog));
for (const [k, v] of w1.updates) applied[k] = { key: k, json: v };
const p2 = planRegen(applied, { now });
check('re-planning after the write yields no plans (no runaway)', p2.length === 0, p2.map((p) => `${p.name}/${p.why}`).join(', ') || 'clean');

// no MarketplaceModel at all -> still works, just no stock signal and no stock write
const noMp = har();
delete noMp.MarketplaceModel;
const noMpPlans = planRegen(noMp, { now });
const noMpR = buildRegenUpdates(noMp, noMpPlans, { timerData: noMp.TimerModel.json.data, now });
check('missing MarketplaceModel is tolerated (timer path only)',
  noMpPlans.length === 2 && noMpPlans.every((p) => p.why === 'timer' && p.stockBefore === null) && !noMpR.updates.has('MarketplaceModel'));

// --- 3. solver integration: reward folded into InventoryModel exactly once -----
const models = har();
const out = buildUpdates(models, [], {
  bps: null, progression: null,
  collect: false, loot: false, work: false, orders: false, crates: 0,
});
const inv = out.updates.get('InventoryModel')?.data;
check('solver writes InventoryModel once with every reload folded in',
  inv?.crates === 10 && inv?.gems === 180 && inv?.energy === 85, `crates ${inv?.crates} gems ${inv?.gems} energy ${inv?.energy}`);
check('solver writes all three models',
  out.updates.has('RegenerationServiceModel') && out.updates.has('TimerModel') && out.updates.has('MarketplaceModel'));
check('reload appears in rewardSummaries', out.rewardSummaries.filter((s) => s.startsWith('reload ')).length === 3);
check('no exp/level change from a reload', inv?.exp === 6614 && inv?.level === 13);

const off = buildUpdates(har(), [], { bps: null, progression: null, collect: false, loot: false, work: false, orders: false, crates: 0, regen: false });
check('regen:false disables it', !off.updates.has('RegenerationServiceModel') && off.updates.size === 0);

// --- 4. table hygiene ----------------------------------------------------------
check('3 automatable reloads', GENERATORS.length === 3 && GENERATORS.every((g) => g.amount && g.durationMs));
check('2 automatable stock refills', PASSIVE.length === 2 && PASSIVE.every((g) => g.name && g.key && g.config));
check('8 gated / unmapped generators documented with a reason',
  NOT_AUTOMATED.length === 8 && NOT_AUTOMATED.every((g) => g.reason));
check('event_energy_5_no_ads is excluded on the cap reading',
  NOT_AUTOMATED.some((g) => g.name === 'event_energy_5_no_ads' && /cap/.test(g.reason)));
check('the stock refills are no longer listed as non-automated',
  !NOT_AUTOMATED.some((g) => g.name === 'crates_generator' || g.name === 'energy_generator'));

// --- 5. passive stock refills (crates_generator / energy_generator) -------------
// The two generators nobody taps: the client tops the counter up as time passes and stalls at the
// ceiling. Ceiling and rate are in the `config` jsonpack, not in the obfuscated client.
const ceilings = loadCeilings();
check('ceilings read from config_jsonpack.json (npm run config)',
  !!ceilings?.crates_generator && !!ceilings?.energy_generator, JSON.stringify(ceilings));
check('crate ceiling/rate pinned by the config pack',
  ceilings?.crates_generator?.max === 40 && ceilings?.crates_generator?.per === 5 &&
  ceilings?.crates_generator?.intervalMs === 300000);
check('energy ceiling/rate pinned by the config pack',
  ceilings?.energy_generator?.max === 50 && ceilings?.energy_generator?.per === 1 &&
  ceilings?.energy_generator?.intervalMs === 180000);

// The live account on 2026-10-16T21:44Z: crates 0 with a 4h19m-old clock and no timer (the player
// was looking at the `40/40` this refill produces), energy 30 with a 28h-old clock.
const stockFixture = () => ({
  RegenerationServiceModel: {
    key: 'RegenerationServiceModel',
    json: {
      data: {
        crates_generator: { timerId: null, lastStartTime: now - (4 * H + 19 * MIN) },
        energy_generator: { timerId: null, lastStartTime: now - 28 * H },
      },
      version: 4,
    },
  },
  TimerModel: {
    key: 'TimerModel',
    json: {
      data: {
        timers: [
          { id: 2364, started: now - 300000, state: 'ACTIVE', label: 'regenerate_crates_generator', duration: 300000, timeSource: 'server' },
        ],
        nextTimerId: 2367,
      },
      version: 1,
    },
  },
  InventoryModel: {
    key: 'InventoryModel',
    json: { data: { level: 14, exp: 632, coins: 389, gems: 185, energy: 30, crates: 0 }, version: 1 },
  },
});

const refills = planPassive(stockFixture(), { now, ceilings });
const byGen = Object.fromEntries(refills.map((p) => [p.name, p]));
check('both stock refills plan', refills.length === 2, refills.map((p) => `${p.name}/+${p.amount}`).join(', '));
check('crates: 51 intervals accrued -> +40, clamped to the 40 ceiling',
  byGen.crates_generator?.amount === 40 && byGen.crates_generator?.pending === 51 &&
  byGen.crates_generator?.ceiling === 40 && byGen.crates_generator?.current === 0,
  JSON.stringify(byGen.crates_generator));
check('energy: 560 intervals accrued -> +20 (30 of the 50 ceiling already held)',
  byGen.energy_generator?.amount === 20 && byGen.energy_generator?.pending === 560 &&
  byGen.energy_generator?.ceiling === 50);
check('the clock resets to now, like the client\'s own write',
  byGen.crates_generator?.nextStartTime === now && byGen.energy_generator?.nextStartTime === now);
check('intervals that did not fit are reported as lost at the ceiling',
  byGen.crates_generator?.spent === 8 && byGen.crates_generator?.wasted === 43);
check('passive plans are marked kind:passive, reloads are not',
  refills.every((p) => p.kind === 'passive') && planRegen(har(), { now }).every((p) => p.kind === 'reload'));

// parked at (or above) the ceiling: the generator stalls and the clock is NOT touched - this is the
// live reading of crates 60 with `lastStartTime` 4h19m old
const parked = stockFixture();
parked.RegenerationServiceModel.json.data.crates_generator.lastStartTime = now - (4 * H + 19 * MIN);
parked.InventoryModel.json.data.crates = 60;
check('parked above the ceiling -> no plan, clock untouched',
  !planPassive(parked, { now, ceilings }).some((p) => p.name === 'crates_generator'));
const atCap = stockFixture();
atCap.InventoryModel.json.data.crates = 40;
check('exactly at the ceiling -> no plan', !planPassive(atCap, { now, ceilings }).some((p) => p.name === 'crates_generator'));

// an interval that has not landed yet -> nothing, even below the ceiling
const fresh = stockFixture();
fresh.RegenerationServiceModel.json.data.crates_generator.lastStartTime = now - 299000;
check('clock has not produced an interval -> no plan',
  !planPassive(fresh, { now, ceilings }).some((p) => p.name === 'crates_generator'));

// a partial fit tops the counter up to the ceiling instead of stalling the generator short of it
const partial = stockFixture();
partial.InventoryModel.json.data.crates = 38;
const partialPlan = planPassive(partial, { now, ceilings }).find((p) => p.name === 'crates_generator');
check('crates at 38/40 -> +2 (topped up, not stalled)',
  partialPlan?.amount === 2 && partialPlan?.spent === 1 && partialPlan?.wasted === 50);

// no config pack -> leave the refills alone rather than guess a ceiling
check('no ceilings -> no passive plans (fail closed)',
  planPassive(stockFixture(), { now, ceilings: null }).length === 0);
check('planRegen(passive:false) skips them',
  !planRegen(stockFixture(), { now, ceilings, passive: false }).length);

// --- 5b. the write -------------------------------------------------------------
const sf = stockFixture();
const sr = buildRegenUpdates(sf, planPassive(sf, { now, ceilings }), { now });
check('no MarketplaceModel stock is spent', !sr.updates.has('MarketplaceModel'));
const svc2 = sr.updates.get('RegenerationServiceModel')?.data;
const st = sr.updates.get('TimerModel')?.data;
const armed = st?.timers.filter((t) => t.started === now && /_generator$/.test(t.label));
check('both refills arm a regenerate_<name> timer, like the client does',
  armed?.length === 2 && armed.every((t) => t.duration === (t.label.includes('crates') ? 300000 : 180000)),
  armed?.map((t) => `${t.label}/${t.duration}`).join(', '));
check('the stale crate timer is replaced, not reused',
  st?.timers.filter((t) => t.label === 'regenerate_crates_generator').length === 2 &&
  st?.timers.find((t) => t.id === 2364)?.started === now - 300000);
check('nextTimerId advanced by 2', st?.nextTimerId === 2369);
check('both generators advanced, timerId re-pointed at the new timer',
  svc2?.crates_generator?.lastStartTime === now && svc2?.crates_generator?.timerId === 2367 &&
  svc2?.energy_generator?.lastStartTime === now && svc2?.energy_generator?.timerId === 2368);
check('version preserved', sr.updates.get('RegenerationServiceModel')?.version === 4);
check('summary names the amount, the ceiling and the loss',
  sr.summaries.some((s) => s.includes('stock refill crates_generator: +40 crates [generator]') && s.includes('up to the 40 ceiling') && s.includes('43 lost at the ceiling')),
  sr.summaries.join(' | '));

// solver integration: the refill is folded into InventoryModel once, with everything else
const sf2 = stockFixture();
const sout = buildUpdates(sf2, [], {
  bps: null, progression: null, collect: false, loot: false, work: false, orders: false, crates: 0,
  ceilings,
});
const sinv = sout.updates.get('InventoryModel')?.data;
check('solver folds the refill into InventoryModel once',
  sinv?.crates === 40 && sinv?.energy === 50, `crates ${sinv?.crates} energy ${sinv?.energy}`);
check('refill appears in rewardSummaries',
  sout.rewardSummaries.filter((s) => s.startsWith('stock refill ')).length === 2);
check('no exp/level change from a refill', sinv?.exp === 632 && sinv?.level === 14);

// idempotence: re-planning the written state must plan nothing (the ceiling + the spent clock)
const applied2 = JSON.parse(JSON.stringify(sf2));
for (const [k, v] of sout.updates) applied2[k] = { key: k, json: v };
check('re-planning after the write yields no plans (no runaway)',
  planPassive(applied2, { now, ceilings }).length === 0,
  planPassive(applied2, { now, ceilings }).map((p) => p.name).join(', ') || 'clean');

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASS'}`);
process.exit(fails ? 1 : 0);
