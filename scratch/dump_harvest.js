import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';
import fs from 'node:fs';
import { tiles } from '../lib/board.js';

const bps = loadBlueprints();
for (const id of ['wheat_4', 'chicken_4', 'carrot_4', 'sugarcane_4', 'cow_4']) {
  const h = resolveBlueprint(bps, id).harvestable;
  console.log(`\n### ${id}`);
  if (!h) { console.log('  (no harvestable component)'); continue; }
  console.log(`  harvests=${h.harvests} duration=${h.duration} depleted=${h.depleted} type=${h.harvestableType}`);
  console.log('  harvestReward:');
  (h.harvestReward || []).forEach((group, i) => {
    const parts = group.map((g) => `${g.chance}%->[${(g.items || []).map((x) => `${x.key}x${x.weight}`).join(', ')}]`);
    console.log(`    stage[${i}]: ${parts.join('  ')}`);
  });
}

const m = JSON.parse(fs.readFileSync('state.json', 'utf8'));
console.log('\n\n=== live tiles carrying `lootable` ===');
for (const v of tiles(m).values()) {
  if (!v?.data?.lootable) continue;
  console.log(`  (${v.row},${v.col}) ${v.blueprint}`);
  console.log(`      ${JSON.stringify(v.raw.data)}`);
}

console.log('\n=== live tiles carrying `cooldown` ===');
for (const v of tiles(m).values()) {
  if (!v?.data?.cooldown) continue;
  console.log(`  (${v.row},${v.col}) ${v.blueprint} ${JSON.stringify(v.raw.data)}`);
}
