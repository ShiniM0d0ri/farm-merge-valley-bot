import fs from 'node:fs';
const base = './config/';

for (const f of ['controlled_randomness_jsonpack.json', 'recipes_jsonpack.json', 'buildings_jsonpack.json']) {
  const j = JSON.parse(fs.readFileSync(base + f, 'utf8'));
  const keys = Object.keys(j);
  console.log(`\n===== ${f}  (${keys.length} top-level keys) =====`);
  console.log('keys:', keys.slice(0, 25).join(', '));
  const first = keys[0];
  console.log(`\n-- sample [${first}] --`);
  console.log(JSON.stringify(j[first], null, 1).slice(0, 1200));
}
