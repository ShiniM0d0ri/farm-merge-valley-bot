import fs from 'node:fs';
import { resolveBlueprint } from '../lib/blueprints.js';
const CFG = process.env.FMV_CFG || './config/blueprints_jsonpack.json';
const bps = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const names = process.argv.length > 2 ? process.argv.slice(2) : ['chicken_4'];
for (const n of names) {
  const h = resolveBlueprint(bps, n)?.harvestable;
  if (!h) { console.log(`\n### ${n}: no harvestable`); continue; }
  const { sprite, ...rest } = h;
  console.log(`\n### ${n}`);
  console.log(JSON.stringify(rest, null, 1));
}
