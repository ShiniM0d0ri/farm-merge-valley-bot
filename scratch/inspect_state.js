// Which component keys does the game actually persist per blueprint?
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const byBp = new Map();
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_') || !m.json) continue;
  const st = m.json?.data?.state;
  if (!st) continue;
  const keys = Object.keys(st.data || {}).sort();
  const sig = keys.join(',') || '(none)';
  if (!byBp.has(sig)) byBp.set(sig, new Set());
  byBp.get(sig).add(st.blueprint);
}
console.log('=== persisted data-key signatures ===');
for (const [sig, bps] of [...byBp].sort()) {
  console.log(`  [${sig}]  <- ${[...bps].sort().join(', ')}`);
}

console.log('\n=== sample full state per blueprint ===');
const seen = new Set();
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_') || !m.json) continue;
  const st = m.json?.data?.state;
  if (!st || seen.has(st.blueprint)) continue;
  seen.add(st.blueprint);
  console.log(`  ${st.blueprint}: ${JSON.stringify(st)}`);
}
