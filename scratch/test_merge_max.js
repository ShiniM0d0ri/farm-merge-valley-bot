// scratch/test_merge_max.js - the merge-maximising planner (lib/solver.js planMerges / bestSplit).
//
// The client merges 3 identical tiles into 1 of the next tier, and 5 identical tiles into 2 (the
// "bonus" merge, counted by UserStatsModel.totalBonusMerges; the effect sprite in the client bundle
// is literally `Merge_5_Floter` and the onboarding teaches it as `merge_bonus_*`). EXP is paid per
// *output* tile at `expReward` of the source, so "maximise output" and "maximise EXP" are the same
// objective - and `bestSplit` solves it exactly (5-groups first, then 3-groups).
//
// HAR evidence for the 5-merge (farm_merge_level_up.har, saves compared pairwise):
//   save 28  totalBonusMerges 305->306, exp +18, two cow_3 tiles appear   (5x cow_2, 2 x 9 exp)
//   save 35  totalNormalMerges 1195->1196 AND totalBonusMerges 306->307, exp +9  (3x + 2x3 exp)
//   save 36  6x sugarcane_2 -> 2x sugarcane_3, exp +18, totalBonusMerges unchanged  (two 3-merges)
import { loadBlueprints, loadProgression, resolveBlueprint, persistedState } from '../lib/blueprints.js';
import { filledTile, emptyTile } from '../lib/board.js';
import { planMerges, buildUpdates, bestSplit, MERGE_SIZES } from '../lib/solver.js';
import { buildHarvestUpdates, producerState } from '../lib/harvest.js';

let fails = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `   ${extra}` : ''}`);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const bps = loadBlueprints();
const progression = loadProgression();
const now = Date.now();

const T = (r, c, bp, data) => [`TilesStateModel_${r}:${c}`, { key: `TilesStateModel_${r}:${c}`, json: filledTile(bp, data) }];
const dataOf = (updates, key) => updates.get(key)?.data?.state?.data;
const bpOf = (updates, key) => updates.get(key)?.data?.state?.blueprint;
const outputsOf = (moves) => moves.reduce((n, m) => n + m.keeps.length, 0);
const expOf = (moves) => moves.reduce((n, m) => n + (m.expReward || 0) * m.keeps.length, 0);
const shape = (moves) => moves.map((m) => `${m.blueprint}${m.bonus ? '(5)' : '(3)'}`).join(' ');

// ---- 1. the split rule ----------------------------------------------------------
check('n=5 is a single bonus merge (2 outputs)', eq(bestSplit(5), { bonus: 1, normal: 0, outputs: 2, used: 5 }));
check('n=3 is a single normal merge (1 output)', eq(bestSplit(3), { bonus: 0, normal: 1, outputs: 1, used: 3 }));
check('n=6 is one bonus merge, not two 3-merges (same output, 1 tile banked)',
  eq(bestSplit(6), { bonus: 1, normal: 0, outputs: 2, used: 5 }));
check('n=7 is one bonus merge (2 tiles banked)', eq(bestSplit(7), { bonus: 1, normal: 0, outputs: 2, used: 5 }));
check('n=8 is bonus + normal (3 outputs)', eq(bestSplit(8), { bonus: 1, normal: 1, outputs: 3, used: 8 }));
check('n=12 is two bonus merges (2 tiles banked)', eq(bestSplit(12), { bonus: 2, normal: 0, outputs: 4, used: 10 }));
check('n=13 is two bonus + normal (5 outputs)', eq(bestSplit(13), { bonus: 2, normal: 1, outputs: 5, used: 13 }));
check('n=27 is five bonus merges, not 3x5 + 4x3 (same 10 outputs, 2 tiles banked)',
  eq(bestSplit(27), { bonus: 5, normal: 0, outputs: 10, used: 25 }));
check('n=4 leaves one stranded', eq(bestSplit(4), { bonus: 0, normal: 1, outputs: 1, used: 3 }));
check('n=2 cannot merge', eq(bestSplit(2), { bonus: 0, normal: 0, outputs: 0, used: 0 }));
check('minMerge 5 forbids the normal merge', bestSplit(9, [5]).bonus === 1 && bestSplit(9, [5]).normal === 0);

// independent formulation: an exhaustive DP over group sizes must agree on the output count
{
  const OUT = { 3: 1, 5: 2 };
  const dp = (n) => {
    if (n < 3) return 0;
    let best = 0;
    for (const g of MERGE_SIZES) if (n >= g) best = Math.max(best, OUT[g] + dp(n - g));
    return best;
  };
  const bad = [];
  for (let n = 1; n <= 60; n++) if (bestSplit(n).outputs !== dp(n)) bad.push(`${n}:${bestSplit(n).outputs}!=${dp(n)}`);
  check('bestSplit == exhaustive DP for every n = 1..60', bad.length === 0, bad.join(' '));
}

// ---- 2. the blueprint table the fixtures lean on --------------------------------
const w1 = resolveBlueprint(bps, 'wheat_1').mergeable;
const w2 = resolveBlueprint(bps, 'wheat_2').mergeable;
const w3 = resolveBlueprint(bps, 'wheat_3').mergeable;
const c3 = resolveBlueprint(bps, 'chicken_3').mergeable;
check('wheat_1 -> wheat_2, exp 3', w1?.target === 'wheat_2' && w1?.expReward === 3);
check('wheat_2 -> wheat_3, exp 9', w2?.target === 'wheat_3' && w2?.expReward === 9);
check('wheat_3 -> wheat_4, exp 27', w3?.target === 'wheat_4' && w3?.expReward === 27);
check('wheat_4 is a producer (no mergeable)', !resolveBlueprint(bps, 'wheat_4').mergeable);
check('chicken_3 -> chicken_4, exp 27', c3?.target === 'chicken_4' && c3?.expReward === 27);

const board = (list, extra = {}) => ({
  ...Object.fromEntries(list.map(([r, c, bp, data]) => T(r, c, bp, data))),
  InventoryModel: { key: 'InventoryModel', json: { data: { level: 14, exp: 419, coins: 308, gems: 180, energy: 40, crates: 0 }, version: 1 } },
  TimerModel: { key: 'TimerModel', json: { data: { timers: [], nextTimerId: 900 }, version: 1 } },
  UserStatsModel: { key: 'UserStatsModel', json: { data: { totalEarnedXP: 16611, totalNormalMerges: 1240, totalBonusMerges: 309 }, version: 1 } },
  ...extra,
});
// everything except the merge machinery turned off, so only merges show up in the updates
const OFF = { collect: false, loot: false, work: false, orders: false, crates: 0, regen: false, producers: false, levelUpRewards: false, visitorRewards: false };

// ---- 3. a full cascade in one plan: 27 wheat_1 ----------------------------------
const cells = [];
for (let r = 10; r < 13; r++) for (let c = 10; c < 19; c++) cells.push([r, c, 'wheat_1', { mergeable: w1 }]);
check('fixture is 27 wheat_1', cells.length === 27);
const models = board(cells);

{
  const moves = planMerges(models, { bps });
  const tier = (bp) => moves.filter((m) => m.blueprint === bp);
  check('27 wheat_1 -> 8 moves (5 wheat_1 + 2 wheat_2 + 1 wheat_3)', moves.length === 8, shape(moves));
  check('the five wheat_1 merges are all bonus merges', tier('wheat_1').length === 5 && tier('wheat_1').every((m) => m.bonus));
  check('they produce 10 wheat_2 -> two bonus merges', tier('wheat_2').length === 2 && tier('wheat_2').every((m) => m.bonus));
  check('those produce 4 wheat_3 -> one normal merge into wheat_4', tier('wheat_3').length === 1 && !tier('wheat_3')[0].bonus);
  check('the top tier (a producer) is never merged further', !moves.some((m) => m.blueprint === 'wheat_4'));
  check('moves are emitted lowest tier first (a source before its own output)',
    eq(moves.map((m) => m.blueprint), ['wheat_1', 'wheat_1', 'wheat_1', 'wheat_1', 'wheat_1', 'wheat_2', 'wheat_2', 'wheat_3']));
  check('a move keeps 2 cells iff it is a bonus merge',
    moves.every((m) => (m.keeps.length === 2) === m.bonus && m.keeps.length + m.consume.length === (m.bonus ? 5 : 3)));
  check('27 tiles -> 15 outputs (the all-3 policy would yield 13)', outputsOf(moves) === 15);
  check('exp = sum(expReward x outputs) = 93 (all-3 would be 81)', expOf(moves) === 93);

  const consumed = moves.flatMap((m) => m.consume);
  const consumedKeys = consumed.map((k) => k.key);
  check('no cell is consumed twice', new Set(consumedKeys).size === consumedKeys.length);
  check('2 wheat_1 stay banked (the 25-tile split)', moves.filter((m) => m.blueprint === 'wheat_1').length === 5);

  const r = buildUpdates(models, moves, { bps, progression, ...OFF });
  check('buildUpdates pays the same 93 exp', r.expGained === 93);
  check('7 bonus merges + 1 normal merge counted separately', r.bonusMerges === 7 && r.normalMerges === 1);
  check('all 23 consumed cells are emptied',
    consumed.length === 23 && consumed.every((k) => eq(r.updates.get(k.key), emptyTile())));

  // a cascade rewrites its own output cells (10 wheat_2 -> 4 kept + 6 consumed); the wire only ever
  // carries the *last* write, because the save is a map keyed by cell.
  const touched = [...new Set(moves.flatMap((m) => [...m.keeps, ...m.consume].map((k) => k.key)))];
  check('every cell ends in the state of the last move touching it', touched.every((key) => {
    const last = moves.filter((m) => [...m.keeps, ...m.consume].some((k) => k.key === key)).pop();
    return last.keeps.some((k) => k.key === key)
      ? bpOf(r.updates, key) === last.target
      : eq(r.updates.get(key), emptyTile());
  }), `${touched.length} cells touched`);

  // the merge that creates a producer is armed in the same save (a producer with no cooldown is inert)
  const four = moves[moves.length - 1].keeps[0];
  check('the wheat_4 producer the merge creates is armed with a cooldown',
    bpOf(r.updates, four.key) === 'wheat_4' && dataOf(r.updates, four.key)?.cooldown?.timerId === 900,
    JSON.stringify(dataOf(r.updates, four.key)));

  const stats = r.updates.get('UserStatsModel').data;
  check('UserStatsModel: totalNormalMerges 1240 -> 1241', stats.totalNormalMerges === 1241);
  check('UserStatsModel: totalBonusMerges 309 -> 316', stats.totalBonusMerges === 316);
  check('UserStatsModel: totalEarnedXP 16611 -> 16704', stats.totalEarnedXP === 16704);

  const need = progression.progression_per_level.levels['14'].exp_to_next_level;
  const inv = r.updates.get('InventoryModel').data;
  const wantExp = 419 + 93 >= need ? 419 + 93 - need : 419 + 93;
  const wantLevel = wantExp < 419 ? 15 : 14;
  check(`InventoryModel exp 419 + 93 = ${wantExp} (level ${wantLevel})`,
    inv.exp === wantExp && inv.level === wantLevel, `exp ${inv.exp} level ${inv.level}`);

  check('a bonus merge is reported as such',
    r.summaries.some((s) => s.includes('x5 -> 2x wheat_2') && s.includes('(bonus)')), r.summaries[0]);
  check('a normal merge is not', r.summaries.some((s) => s.includes('x3 -> wheat_4') && !s.includes('(bonus)')));
}

// ---- 4. the same board under --min=5 / --min=9 ----------------------------------
{
  const five = board(cells.slice(0, 5));
  const three = board(cells.slice(0, 3));
  check('minMerge 5: a trio is left alone', planMerges(three, { bps, minMerge: 5 }).length === 0);
  check('minMerge 5: the five-merge still happens',
    planMerges(five, { bps, minMerge: 5 }).length === 1 && planMerges(five, { bps, minMerge: 5 })[0].bonus);
  check('minMerge 9: nothing merges at all', planMerges(models, { bps, minMerge: 9 }).length === 0);
  check('minMerge 3 (default): the bonus merge is preferred', planMerges(five, { bps })[0].bonus);

  // 9 tiles: one bonus + one normal -> 3 wheat_2, which cascade into 1 wheat_3
  const nine = planMerges(board(cells.slice(0, 9)), { bps });
  check('9 wheat_1 -> bonus + normal, then the 3 wheat_2 merge again',
    eq(shape(nine), 'wheat_1(5) wheat_1(3) wheat_2(3)') && outputsOf(nine) === 4, shape(nine));
}

// ---- 5. a bonus merge into a tier-4 producer arms two cooldowns -------------------
{
  const five = board([[10, 10, 'chicken_3', { mergeable: c3 }], [10, 11, 'chicken_3', { mergeable: c3 }],
    [10, 12, 'chicken_3', { mergeable: c3 }], [10, 13, 'chicken_3', { mergeable: c3 }], [10, 14, 'chicken_3', { mergeable: c3 }]]);
  const moves = planMerges(five, { bps });
  check('5 chicken_3 -> one bonus merge into chicken_4',
    moves.length === 1 && moves[0].bonus && moves[0].target === 'chicken_4' && moves[0].keeps.length === 2);

  const h = buildHarvestUpdates(five, { bps, moves, now });
  const timers = h.updates.get('TimerModel').data.timers;
  check('two cooldown timers, ids 900 and 901', timers.length === 2 && timers[0].id === 900 && timers[1].id === 901);
  check('each timer is labelled by its own cell',
    eq(timers.map((t) => t.label), ['Cooldown:10,10', 'Cooldown:10,11']));
  check('both timers run the 30-minute producer cooldown',
    timers.every((t) => t.duration === 1800000 && t.state === 'ACTIVE' && t.timeSource === 'server'));
  check('both produced tiles carry the producer state',
    eq(dataOf(h.updates, 'TilesStateModel_10:10'), producerState(bps, 'chicken_4', 900)) &&
    eq(dataOf(h.updates, 'TilesStateModel_10:11'), producerState(bps, 'chicken_4', 901)));
  check('two producers are announced', h.summaries.length === 2, h.summaries.join(' | '));

  // the emptied cells belong to buildUpdates, not to the producer half
  const r = buildUpdates(five, moves, { bps, progression, ...OFF });
  check('the three consumed chicken_3 cells are emptied',
    [12, 13, 14].every((c) => eq(r.updates.get(`TilesStateModel_10:${c}`), emptyTile())));
  check('a bonus merge into a producer pays 2 x 27 exp', r.expGained === 54);
}

// ---- 6. a trio still behaves exactly as before -----------------------------------
{
  const three = board(cells.slice(0, 3));
  const moves = planMerges(three, { bps });
  check('3 wheat_1 -> one normal merge, 1 output, 3 exp',
    moves.length === 1 && !moves[0].bonus && moves[0].keeps.length === 1 && expOf(moves) === 3);
  const r = buildUpdates(three, moves, { bps, progression, ...OFF });
  check('a normal merge bumps totalNormalMerges only',
    r.updates.get('UserStatsModel').data.totalNormalMerges === 1241 &&
    r.updates.get('UserStatsModel').data.totalBonusMerges === 309);
  check('the merged tile is the next tier with the table state',
    eq(r.updates.get('TilesStateModel_10:10'), filledTile('wheat_2', persistedState(bps, 'wheat_2'))));
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nALL CHECKS PASS');
process.exit(fails ? 1 : 0);
