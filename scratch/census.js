import fs from 'node:fs';
const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));

const bps = new Map();
const compsets = new Map();
const tiles = [];
for (const [key, m] of Object.entries(models)) {
  if (!key.startsWith('TilesStateModel_')) continue;
  const st = m.json?.data?.state;
  if (!st) continue;
  const [row, col] = key.slice('TilesStateModel_'.length).split(':').map(Number);
  const comps = Object.keys(st.data || {}).sort();
  tiles.push({ row, col, bp: st.blueprint, comps });
  bps.set(st.blueprint, (bps.get(st.blueprint) || 0) + 1);
  const sig = comps.join('+') || '(none)';
  compsets.set(sig, (compsets.get(sig) || 0) + 1);
}

console.log(`${tiles.length} tiles\n`);
console.log('blueprints:');
for (const [b, n] of [...bps].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${b}`);
console.log('\ncomponent sets:');
for (const [s, n] of [...compsets].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${s}`);

console.log('\nnon-mergeable / interesting tiles:');
for (const t of tiles) {
  if (t.bp.startsWith('coin_') || t.bp.startsWith('energy_') || t.bp.startsWith('gem_')) continue;
  const interesting = t.comps.filter((c) => !['mergeable'].includes(c));
  if (interesting.length) console.log(`  (${t.row},${t.col}) ${t.bp}  [${t.comps.join(', ')}]`);
}
