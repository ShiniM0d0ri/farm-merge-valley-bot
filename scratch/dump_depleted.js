import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';
const bps = loadBlueprints();

for (const id of ['base_crop', 'base_animal', 'base_tree', 'base_reward_crate']) {
  const c = resolveBlueprint(bps, id);
  console.log(`\n### ${id} components: ${Object.keys(c).join(', ')}`);
  for (const k of Object.keys(c)) {
    if (/loot|deplet|harvest|reward/i.test(k)) console.log(`   ${k} = ${JSON.stringify(c[k]).slice(0, 700)}`);
  }
}

// anything anywhere that mentions coin_2 or a "depleted" loot table
console.log('\n\n=== blueprints whose JSON mentions "coin_2" ===');
for (const [id, b] of Object.entries(bps)) {
  const s = JSON.stringify(b);
  if (s.includes('coin_2')) console.log(`  ${id}: ${s.slice(0, 300)}`);
}
