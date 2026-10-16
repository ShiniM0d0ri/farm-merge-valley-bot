import fs from 'node:fs';
import { loadProgression } from '../lib/blueprints.js';

const m = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const st = m.UserStatsModel?.json?.data || {};
const inv = m.InventoryModel?.json?.data || {};

console.log('UserStatsModel:');
for (const k of ['totalNormalMerges', 'totalBonusMerges', 'totalEarnedXP', 'totalMergedCrops', 'totalMergedAnimals', 'totalHarvestedItems']) {
  console.log(`  ${k}: ${st[k]}`);
}
console.log(`\nInventoryModel: level ${inv.level}, exp ${inv.exp}`);

const prog = loadProgression();
const levels = prog?.progression_per_level?.levels || prog?.levels || {};
const need = levels[inv.level]?.exp_to_next_level ?? levels[String(inv.level)]?.exp_to_next_level;
console.log(`\nexp_to_next_level(${inv.level}) = ${need}`);
if (need) console.log(`progress: ${inv.exp}/${need}  (${(100 * inv.exp / need).toFixed(1)}%)`);
console.log('\nlevel table (next few):');
for (const lv of [inv.level, inv.level + 1, inv.level + 2, inv.level + 3]) {
  const n = levels[lv]?.exp_to_next_level ?? levels[String(lv)]?.exp_to_next_level;
  if (n != null) console.log(`  level ${lv}: needs ${n}`);
}
