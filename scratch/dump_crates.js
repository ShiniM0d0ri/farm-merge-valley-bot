// scratch/dump_crates.js - full JSON of reward-crate / key tiles, to see the pre-rolled reward shape.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
for (const m of Object.values(models)) {
  if (!m.key.startsWith('TilesStateModel')) continue;
  const st = m.json?.data?.state;
  if (!st || !st.blueprint) continue;
  if (/crate|key/.test(st.blueprint)) {
    console.log(`\n=== ${m.key}  ${st.blueprint} ===`);
    console.log(JSON.stringify(st, null, 2));
  }
}
