import fs from 'node:fs';
const dir = './config/';
const j = JSON.parse(fs.readFileSync(dir + 'blueprints_jsonpack.json', 'utf8'));

console.log('blueprints:', Object.keys(j).length);

const pick = (id) => j[id];
for (const id of ['rock_small', 'rock_medium', 'rock_large', 'tree_medium', 'toolbox_small']) {
  const b = pick(id);
  if (!b) { console.log(`\n-- ${id}: MISSING`); continue; }
  console.log(`\n===== ${id} =====`);
  console.log(JSON.stringify(b, null, 1).slice(0, 2000));
}
