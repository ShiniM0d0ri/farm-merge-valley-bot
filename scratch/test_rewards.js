// scratch/test_rewards.js - replay the farm_merge_level_up.har level-up + visitor reward exactly.
//
// HAR ground truth:
//   save[85]  level 13 exp 6614 -> level 14 exp 2 (6614 + 3 merge exp - 6615)
//   save[86]  crates 0 -> 10, energy 70 -> 80          (levels.13.rewards)
//   visitor   reward [crates 10, carrot 1, coins 2 x3] -> inventory, model reset to {reward:[],player:null}
import { planMerges, buildUpdates } from '../lib/solver.js';
import { loadBlueprints, loadProgression } from '../lib/blueprints.js';
import { loadRecipes, loadBuildings } from '../lib/orders.js';

const bps = loadBlueprints();
const progression = loadProgression();
const recipes = loadRecipes();
const buildings = loadBuildings();

const wheat = (key) => ({
  key,
  json: { data: { state: { blueprint: 'wheat_1', data: { mergeable: { target: 'wheat_2', expReward: 3 } } } }, version: 1 },
});

const models = {
  InventoryModel: {
    json: {
      data: {
        coins: 305, gems: 180, crates: 0, energy: 70, tickets: 1, milk: 1, carrot: 1,
        exp: 6614, level: 13,
      },
      version: 1,
    },
  },
  VisitorRewardModel: {
    json: {
      data: {
        reward: [
          { key: 'crates', amount: 10 },
          { key: 'carrot', amount: 1, bonus: false },
          { key: 'coins', amount: 2 },
          { key: 'coins', amount: 2 },
          { key: 'coins', amount: 2 },
        ],
        player: 'NPC_2',
      },
      version: 1,
    },
  },
  'TilesStateModel_70:67': wheat('TilesStateModel_70:67'),
  'TilesStateModel_70:68': wheat('TilesStateModel_70:68'),
  'TilesStateModel_70:69': wheat('TilesStateModel_70:69'),
};

const moves = planMerges(models, { minMerge: 3 });
const r = buildUpdates(models, moves, { bps, progression, recipes, buildings });

const inv = r.updates.get('InventoryModel')?.data || {};
const vis = r.updates.get('VisitorRewardModel')?.data;

console.log('moves        =', moves.length);
console.log('expGained    =', r.expGained);
console.log('levelInfo    =', JSON.stringify(r.levelInfo));
console.log('rewards      =', JSON.stringify(r.rewardSummaries));
console.log('inventory    =', JSON.stringify(inv));
console.log('visitorModel =', JSON.stringify(vis));

const checks = [
  ['level 13 -> 14', inv.level === 14],
  ['exp rollover 6614 + 3 - 6615 = 2', inv.exp === 2],
  ['level reward energy 70 -> 80', inv.energy === 80],
  ['level reward crates +10', inv.crates === 20], // 0 + 10 (level) + 10 (visitor)
  ['visitor crates +10 on top of the level reward', inv.crates === 20],
  ['visitor carrot 1 -> 2', inv.carrot === 2],
  ['visitor coins 305 -> 311 (3x2)', inv.coins === 311],
  ['VisitorRewardModel reset', vis && vis.reward.length === 0 && vis.player === null],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) ok = false;
}
console.log(`\nREWARDS: ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
