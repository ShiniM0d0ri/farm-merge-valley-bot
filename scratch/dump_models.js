// scratch/dump_models.js - compact dump of every non-tile model.
import fs from 'node:fs';
const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
for (const k of Object.keys(models).sort()) {
  if (k.startsWith('TilesStateModel')) continue;
  const s = JSON.stringify(models[k].json?.data ?? models[k].json);
  console.log(`\n### ${k}`);
  console.log(s.length > 900 ? s.slice(0, 900) + ` …(+${s.length - 900})` : s);
}
