// scratch/test_harvest.js - the tier-4 producer lifecycle, replayed against the launch capture.
//
// Every fixture value is taken verbatim from farm_merge_launch.har:
//   initial read  {"id":2129,"label":"Cooldown:66,71","state":"ACTIVE","started":1792086244134,
//                  "duration":1800000,"timeSource":"server"}
//   tile (merge)  {"cooldown":{"timerId":2129},"hitpoints":{"startAsVisible":false,"max":1,"current":2}}
//   tile (landed) {"hitpoints":{"startAsVisible":false,"max":1,"current":2},
//                  "lootable":{"loot":["egg","egg","egg","egg","egg"],"lootingRemovesObject":false}}
//   cow_4 landed  {"...","loot":["milk","milk","milk","milk"]}
//
// The loot is a client roll over `harvestable.harvestReward[round][slot]`, each slot
// `{chance, items}`: round 0 of every tier-4 is 100/100/100/50/25. Feeding a fixed rng reproduces the
// capture's exact arrays, which is the strongest available check on the decoded algorithm.
import { loadBlueprints, loadProgression, resolveBlueprint } from '../lib/blueprints.js';
import { filledTile, emptyTile } from '../lib/board.js';
import { planMerges, planLoots, buildUpdates } from '../lib/solver.js';
import {
  HARVEST_DURATION_MS, cooldownLabel, isProducer, producerState, drawHarvest,
  planMaterialisations, planRepairs, buildHarvestUpdates,
} from '../lib/harvest.js';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const bps = loadBlueprints();
const progression = loadProgression();
const now = Date.now();
const DUR = HARVEST_DURATION_MS;

const T = (r, c, bp, data) => [`TilesStateModel_${r}:${c}`, { key: `TilesStateModel_${r}:${c}`, json: filledTile(bp, data) }];
const dataOf = (updates, key) => updates.get(key)?.data?.state?.data;

// ---- 1. the roll reproduces the capture exactly --------------------------------
const chicken = resolveBlueprint(bps, 'chicken_4').harvestable;
const cow = resolveBlueprint(bps, 'cow_4').harvestable;

// rng 0.1: 100/100/100 pass, 50 passes (10<50), 25 passes (10<25) -> 5 rolls, each picks `egg`.
check('chicken_4 round 0 with rng 0.1 == the capture ["egg","egg","egg","egg","egg"]',
  eq(drawHarvest(chicken, null, 0, () => 0.1), ['egg', 'egg', 'egg', 'egg', 'egg']));
// rng 0.4: 100/100/100 pass, 50 passes (40<50), 25 fails (40>25) -> 4 rolls.
check('cow_4 round 0 with rng 0.4 == the capture ["milk","milk","milk","milk"]',
  eq(drawHarvest(cow, null, 0, () => 0.4), ['milk', 'milk', 'milk', 'milk']));
// rng 0.6: only the three 100% slots -> 3 rolls
check('rng 0.6 fails the 50% and 25% slots -> 3 items',
  drawHarvest(chicken, null, 0, () => 0.6).length === 3);
check('round 1 has six slots (100/100/100/100/50/50) -> 6 items at rng 0.1',
  drawHarvest(chicken, null, 1, () => 0.1).length === 6);
check('round index clamps past the table', drawHarvest(chicken, null, 99, () => 0.1).length === 8);
check('a slot only yields keys from its own table',
  drawHarvest(chicken, null, 0, () => 0.1).every((k) => ['egg', 'upgrade_card_1'].includes(k)));

// pity: a big weightIncrease on the rare key flips the pick
const bigPity = { context: 'chicken_4', items: [{ key: 'egg', cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 0 }, { key: 'upgrade_card_1', cooldownAmount: 0, weightIncrease: 100000, unsuccesfulAttempts: 0 }] };
const pityPick = drawHarvest(chicken, bigPity, 0, () => 0.999);
check('upgrade_card_1 weightIncrease can win a slot', pityPick[2] === 'upgrade_card_1', pityPick.join(','));
check('a hit on the rare key resets its banked weightIncrease', bigPity.items[1].weightIncrease === 0 && bigPity.items[1].unsuccesfulAttempts === 0,
  `wi ${bigPity.items[1].weightIncrease} att ${bigPity.items[1].unsuccesfulAttempts}`);
const hit = { context: 'chicken_4', items: [{ key: 'egg', cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 7 }] };
drawHarvest(chicken, hit, 0, () => 0.1);
check('a hit resets that key\'s pity', hit.items[0].unsuccesfulAttempts === 0);

// ---- 2. gating ------------------------------------------------------------------
check('chicken_4 is a producer', isProducer(bps, 'chicken_4'));
check('toolbox_medium is not (hitpoints without harvestable)', !isProducer(bps, 'toolbox_medium'));
check('wood_4 is not (it merges up to wood_5)', !isProducer(bps, 'wood_4'));
check('producerState matches the capture tile',
  eq(producerState(bps, 'chicken_4', 2129), { cooldown: { timerId: 2129 }, hitpoints: { startAsVisible: false, max: 1, current: 2 } }));
check('cooldown label is Cooldown:<row>,<col>', cooldownLabel(66, 71) === 'Cooldown:66,71');

// ---- 3. merge arms a producer ---------------------------------------------------
const mergeModels = () => ({
  ...Object.fromEntries([T(66, 71, 'chicken_3', { mergeable: { target: 'chicken_4', expReward: 27 } }),
    T(66, 72, 'chicken_3', { mergeable: { target: 'chicken_4', expReward: 27 } }),
    T(66, 73, 'chicken_3', { mergeable: { target: 'chicken_4', expReward: 27 } })]),
  InventoryModel: { key: 'InventoryModel', json: { data: { level: 14, exp: 419, coins: 308, gems: 180, energy: 40, crates: 0, egg: 3 }, version: 1 } },
  TimerModel: { key: 'TimerModel', json: { data: { timers: [], nextTimerId: 300 }, version: 1 } },
});
{
  const models = mergeModels();
  const moves = planMerges(models);
  check('planMerges finds the chicken_3 trio -> chicken_4', moves.length === 1 && moves[0].target === 'chicken_4');
  const r = buildHarvestUpdates(models, { bps, moves, now });
  const tm = r.updates.get('TimerModel').data;
  check('merged producer tile is identical to the capture',
    eq(dataOf(r.updates, 'TilesStateModel_66:71'), { cooldown: { timerId: 300 }, hitpoints: { startAsVisible: false, max: 1, current: 2 } }));
  check('its cooldown timer is created with the capture shape',
    eq(tm.timers[0], { id: 300, started: now, state: 'ACTIVE', label: 'Cooldown:66,71', duration: 1800000, timeSource: 'server' }));
  check('nextTimerId advanced', tm.nextTimerId === 301);
  check('summary names the tile and the timer', r.summaries[0] === 'chicken_4 @ (66,71) started producing (timer 300, 30 min)', r.summaries[0]);
}

// ---- 4. materialisation ---------------------------------------------------------
const landed = (bp, r, c, { timerId = 2129, started = now - DUR - 60000, label = cooldownLabel(r, c), hp = { startAsVisible: false, max: 1, current: 2 } } = {}) => ({
  ...Object.fromEntries([T(r, c, bp, { cooldown: { timerId }, hitpoints: hp })]),
  TimerModel: { key: 'TimerModel', json: { data: { timers: [{ id: timerId, started, state: 'ACTIVE', label, duration: DUR, timeSource: 'server' }], nextTimerId: 2130 }, version: 1 } },
  PseudoRandomnessModel: { key: 'PseudoRandomnessModel', json: { data: { data: [{ context: bp, items: [{ key: 'egg', cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 0 }, { key: 'upgrade_card_1', cooldownAmount: 0, weightIncrease: 0, unsuccesfulAttempts: 0 }] }] }, version: 1 } },
});
{
  const models = landed('chicken_4', 66, 72);
  const plans = planMaterialisations(models, { bps, now });
  check('an expired cooldown is planned', plans.length === 1 && plans[0].why === 'expired');
  const r = buildHarvestUpdates(models, { bps, now, rng: () => 0.1 });
  check('materialised tile is identical to the capture',
    eq(dataOf(r.updates, 'TilesStateModel_66:72'), {
      hitpoints: { startAsVisible: false, max: 1, current: 2 },
      lootable: { loot: ['egg', 'egg', 'egg', 'egg', 'egg'], lootingRemovesObject: false },
    }), JSON.stringify(dataOf(r.updates, 'TilesStateModel_66:72')));
  const tm = r.updates.get('TimerModel').data;
  check('the spent timer is deleted', tm.timers.length === 0);
  check('nextTimerId untouched by a materialisation', tm.nextTimerId === 2130);
  const pr = r.updates.get('PseudoRandomnessModel').data.data.find((c) => c.context === 'chicken_4');
  check('PseudoRandomnessModel advances the producer context',
    pr.items.find((i) => i.key === 'upgrade_card_1').unsuccesfulAttempts === 1);
  check('materialisation summary', /materialised \(expired\) -> 5 item\(s\): egg, egg, egg, egg, egg/.test(r.summaries[0]), r.summaries[0]);

  // a running cooldown is left alone
  const running = landed('chicken_4', 66, 72, { started: now - 60000 });
  check('a cooldown still running is not planned', planMaterialisations(running, { bps, now }).length === 0);
  check('...and writes nothing', buildHarvestUpdates(running, { bps, now }).updates.size === 0);

  // a timer that vanished (pre-fix mercilessly inert tiles) is treated as landed
  const orphan = landed('goat_4', 50, 56);
  orphan.TimerModel.json.data.timers = [];
  const op = planMaterialisations(orphan, { bps, now });
  check('a producer whose timer is gone is planned (why=timer-missing)', op.length === 1 && op[0].why === 'timer-missing');

  // the second harvest uses round 1
  const second = landed('chicken_4', 66, 72, { hp: { startAsVisible: false, max: 1, current: 1 } });
  const r2 = buildHarvestUpdates(second, { bps, now, rng: () => 0.1 });
  check('the second harvest rolls round 1 -> six items',
    dataOf(r2.updates, 'TilesStateModel_66:72').lootable.loot.length === 6,
    JSON.stringify(dataOf(r2.updates, 'TilesStateModel_66:72').lootable.loot));

  // an already-lootable tile is never re-materialised
  const already = landed('chicken_4', 66, 72);
  already['TilesStateModel_66:72'].json = filledTile('chicken_4', { hitpoints: { max: 1, current: 2 }, lootable: { loot: ['egg'], lootingRemovesObject: false } });
  check('a lootable tile is not materialised again', planMaterialisations(already, { bps, now }).length === 0);
}

// ---- 5. repairing the inert producers -------------------------------------------
{
  const models = {
    ...Object.fromEntries([
      T(50, 56, 'goat_4', {}),
      T(68, 70, 'toolbox_medium', { hitpoints: { startAsVisible: false, max: 5, current: 4 } }),
      T(57, 58, 'tree_medium', { hitpoints: { startAsVisible: false, max: 5, current: 1 } }),
    ]),
    TimerModel: { key: 'TimerModel', json: { data: { timers: [], nextTimerId: 500 }, version: 1 } },
  };
  const repairs = planRepairs(models, { bps });
  check('only the harvestable inert tile is repaired', repairs.length === 1 && repairs[0].tile.blueprint === 'goat_4',
    repairs.map((r) => r.tile.blueprint).join(','));
  const r = buildHarvestUpdates(models, { bps, now });
  check('repaired tile gets a fresh 30-minute cooldown',
    eq(dataOf(r.updates, 'TilesStateModel_50:56'), { cooldown: { timerId: 500 }, hitpoints: { startAsVisible: false, max: 1, current: 2 } }));
  check('repair timer label + duration', eq(r.updates.get('TimerModel').data.timers[0], { id: 500, started: now, state: 'ACTIVE', label: 'Cooldown:50,56', duration: 1800000, timeSource: 'server' }));
  check('non-producers are untouched', !r.updates.has('TilesStateModel_68:70') && !r.updates.has('TilesStateModel_57:58'));
  check('repair summary', /goat_4 @ \(50,56\) was inert \(no cooldown\) -> repaired, timer 500/.test(r.summaries[0]), r.summaries[0]);

  const off = buildHarvestUpdates(models, { bps, now, repair: false });
  check('repair:false skips inert tiles', off.updates.size === 0);
  const offMerge = buildHarvestUpdates(mergeModels(), { bps, now, repair: false, moves: planMerges(mergeModels()) });
  check('...but a merge is still armed with producers disabled',
    !!offMerge.updates.get('TilesStateModel_66:71') && offMerge.updates.get('TimerModel').data.timers.length === 1);
  check('no TimerModel when there is nothing to do',
    buildHarvestUpdates({ TimerModel: { key: 'TimerModel', json: { data: { timers: [], nextTimerId: 1 }, version: 1 } } }, { bps, now }).updates.size === 0);
}

// ---- 6. solver integration + the loot hand-off ----------------------------------
{
  const models = mergeModels();
  const r = buildUpdates(models, planMerges(models), {
    bps, progression, collect: false, loot: false, work: false, orders: false, crates: 0, regen: false,
  });
  check('buildUpdates arms the producer cooldown',
    eq(dataOf(r.updates, 'TilesStateModel_66:71'), { cooldown: { timerId: 300 }, hitpoints: { startAsVisible: false, max: 1, current: 2 } }));
  check('buildUpdates writes TimerModel with the producer timer',
    r.updates.get('TimerModel').data.timers[0]?.label === cooldownLabel(66, 71));
  check('the merge still pays its EXP', r.updates.get('InventoryModel').data.exp === 419 + 27, String(r.updates.get('InventoryModel').data.exp));
  check('harvestSummaries is exported', Array.isArray(r.harvestSummaries) && r.harvestSummaries.length === 1);

  // materialise in one round, loot in the next
  const materialised = buildHarvestUpdates(landed('cow_4', 66, 73), { bps, now, rng: () => 0.4 });
  const lootModels = Object.fromEntries([T(66, 73, 'cow_4', dataOf(materialised.updates, 'TilesStateModel_66:73'))]);
  check('planLoots sees the freshly materialised tile', planLoots(lootModels).length === 1);
  const pipeline = buildUpdates(
    { ...lootModels, InventoryModel: { key: 'InventoryModel', json: { data: { level: 14, exp: 419, milk: 0 }, version: 1 } } },
    [], { bps, progression, collect: false, work: false, orders: false, crates: 0, regen: false, producers: false }
  );
  check('looting credits 4 milk and spends one harvest',
    pipeline.updates.get('InventoryModel').data.milk === 4 &&
    pipeline.updates.get('TilesStateModel_66:73').data.state.data.hitpoints.current === 1,
    JSON.stringify(pipeline.updates.get('InventoryModel').data));
  check('the depleted tile offers its removeReward', eq(pipeline.updates.get('TilesStateModel_66:73').data.state.data.lootable.loot, ['coin_2']));
}

// ---- 7. hygiene -----------------------------------------------------------------
check('every tier-4 crop/animal is a producer',
  ['chicken_4', 'cow_4', 'wheat_4', 'carrot_4', 'sugarcane_4', 'goat_4'].every((n) => isProducer(bps, n)));
check('the duration is pinned to the capture timer', HARVEST_DURATION_MS === 1800000);

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASS'}`);
process.exit(fails ? 1 : 0);
