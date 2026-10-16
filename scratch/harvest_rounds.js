import fs from 'node:fs';
import { resolveBlueprint } from '../lib/blueprints.js';
const bps = JSON.parse(fs.readFileSync('./config/blueprints_jsonpack.json', 'utf8'));
for (const n of ['chicken_4', 'cow_4', 'wheat_4', 'carrot_4', 'sugarcane_4', 'goat_4']) {
  const h = resolveBlueprint(bps, n).harvestable;
  console.log(`${n}: harvests=${h.harvests} rounds=${h.harvestReward.length} removeReward=${JSON.stringify(h.removeReward)}`);
  h.harvestReward.forEach((round, i) => {
    console.log(`   round ${i}: ${round.map((s) => `${s.chance}%[${s.items.map((x) => `${x.key}:${x.weight}`).join('|')}]`).join('  ')}`);
  });
}
