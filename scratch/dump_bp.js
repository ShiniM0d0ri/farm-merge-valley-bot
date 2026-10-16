// Show resolved (inherited) components for the interesting tile types.
import { loadBlueprints, resolveBlueprint, PERSISTED_KEYS } from '../lib/blueprints.js';

const bps = loadBlueprints();
const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'coin_1', 'coin_3', 'energy_1', 'energy_3',
      'tree_large', 'rock_large', 'toolbox_small',
      'carrot_4', 'sugarcane_4',
      'reward_crate_silver', 'reward_crate_gold',
      'bbq', 'bakery', 'market', 'dairy', 'delivery_truck',
      'wheat_1', 'chicken_1', 'goat_1',
    ];

for (const id of ids) {
  const raw = bps[id];
  if (!raw) { console.log(`\n### ${id}: NOT FOUND`); continue; }
  const comp = resolveBlueprint(bps, id);
  console.log(`\n### ${id}  (extends: ${raw.extends || '-'})`);
  const keys = Object.keys(comp);
  const pr = keys.filter((k) => PERSISTED_KEYS.includes(k));
  const other = keys.filter((k) => !PERSISTED_KEYS.includes(k));
  for (const k of pr) console.log(`  P ${k} = ${JSON.stringify(comp[k])}`);
  for (const k of other) {
    const v = JSON.stringify(comp[k]);
    console.log(`  - ${k} = ${v && v.length > 220 ? v.slice(0, 220) + '...' : v}`);
  }
}
