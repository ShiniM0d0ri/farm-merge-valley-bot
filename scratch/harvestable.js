// scratch/harvestable.js - the full `harvestable` component (+ what it inherits) for every producer.
import fs from 'node:fs';
import { resolveBlueprint } from '../lib/blueprints.js';

const CFG = process.env.FMV_CFG || './config/blueprints_jsonpack.json';
const raw = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const bps = raw.blueprints || raw;

const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(bps).filter((k) => /_4$/.test(k) || k === 'gazebo' || k === 'greenhouse');

for (const name of names) {
  const bp = resolveBlueprint(bps, name);
  if (!bp) { console.log(`\n### ${name}: NOT FOUND`); continue; }
  console.log(`\n### ${name}`);
  console.log(`components: ${Object.keys(bp).join(', ')}`);
  if (bp.harvestable) console.log(`harvestable: ${JSON.stringify(bp.harvestable, null, 1)}`);
  else console.log('  (no harvestable)');
}
