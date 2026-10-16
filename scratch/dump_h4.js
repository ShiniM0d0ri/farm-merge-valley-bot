import { loadBlueprints } from '../lib/blueprints.js';
const b = loadBlueprints();
const h = b.chicken_4.components.harvestable;
console.log('harvestable keys:', Object.keys(h).join(', '));
for (const k of Object.keys(h)) {
  if (k === 'sprite') continue;
  const v = h[k];
  console.log(`\n${k}: ${JSON.stringify(v).slice(0, 2600)}`);
}
