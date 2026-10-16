import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';

const bps = loadBlueprints();
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'sprite' ? undefined : v)));

for (const id of ['chicken_4', 'wheat_4', 'greenhouse']) {
  const c = resolveBlueprint(bps, id);
  console.log(`===== ${id}.harvestable =====`);
  console.log(JSON.stringify(strip(c.harvestable), null, 1));
  console.log('');
}
