import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';
const bps = loadBlueprints();
for (const id of ['rock_small', 'rock_medium', 'rock_large', 'tree_medium', 'tree_large', 'toolbox_small', 'toolbox_medium']) {
  const c = resolveBlueprint(bps, id);
  console.log(`\n### ${id}`);
  console.log('  mapSource:', JSON.stringify(c.mapSource));
  console.log('  hitpoints:', JSON.stringify(c.hitpoints));
  console.log('  source   :', JSON.stringify(c.source));
}
