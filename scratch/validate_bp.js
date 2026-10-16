// Validate: tile.state.data == pick(resolvedBlueprint(bp).components, observedKeys)?
import fs from 'node:fs';

const BP = JSON.parse(fs.readFileSync('../fmv_cfg/blueprints_jsonpack.json', 'utf8'));
const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));

function resolve(id, depth = 0) {
  const b = BP[id];
  if (!b) return { id, components: {} };
  let base = {};
  if (b.extends && depth < 12) base = resolve(b.extends, depth + 1).components;
  return { id, components: { ...base, ...(b.components || {}) } };
}

// union of all persisted keys observed on the board
const observedKeys = new Set();
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_') || !m.json) continue;
  const st = m.json?.data?.state;
  if (!st) continue;
  for (const key of Object.keys(st.data || {})) observedKeys.add(key);
}
console.log('observed persisted component keys:', [...observedKeys].sort().join(', '));

let ok = 0, bad = 0;
const seen = new Set();
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_') || !m.json) continue;
  const st = m.json?.data?.state;
  if (!st) continue;
  if (seen.has(st.blueprint)) continue;
  seen.add(st.blueprint);

  const comp = resolve(st.blueprint).components;
  const synth = {};
  for (const key of Object.keys(st.data || {})) synth[key] = comp[key];
  const match = JSON.stringify(synth) === JSON.stringify(st.data);
  if (match) ok++; else bad++;
  console.log(`${match ? 'OK  ' : 'DIFF'} ${st.blueprint}`);
  if (!match) {
    console.log('   observed:', JSON.stringify(st.data).slice(0, 200));
    console.log('   blueprint:', JSON.stringify(synth).slice(0, 200));
    console.log('   compKeys:', Object.keys(comp).join(','));
  }
}
console.log(`\nmatch ${ok}, differ ${bad}`);
