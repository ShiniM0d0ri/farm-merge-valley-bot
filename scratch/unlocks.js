import { loadProgression } from '../lib/blueprints.js';

const p = loadProgression();
const levels = p.progression_per_level.levels;

const familyOf = (id) => id.replace(/_\d+$/, '');
const tierOf = (id) => Number(id.match(/_(\d+)$/)?.[1] ?? 0);

const famAtLevel = new Map(); // family -> first level unlocked
for (const [lvl, def] of Object.entries(levels)) {
  for (const id of def.items_unlocked || []) {
    const f = familyOf(id);
    if (!famAtLevel.has(f)) famAtLevel.set(f, { level: Number(lvl), tier: tierOf(id), id });
  }
}

console.log('=== first unlock per family ===');
for (const [f, v] of [...famAtLevel].sort((a, b) => a[1].level - b[1].level || a[0].localeCompare(b[0]))) {
  console.log(`  L${String(v.level).padStart(2)}  ${f.padEnd(24)} (${v.id})`);
}

console.log('\n=== items_unlocked per level (1..20) ===');
for (let l = 1; l <= 20; l++) {
  const def = levels[String(l)];
  if (!def) continue;
  const items = def.items_unlocked || [];
  const byFam = {};
  for (const id of items) (byFam[familyOf(id)] ||= []).push(tierOf(id));
  const desc = Object.entries(byFam)
    .map(([f, ts]) => (ts.length > 1 ? `${f}[${ts.join(',')}]` : `${f}_${ts[0]}`))
    .join(' ');
  console.log(`  L${String(l).padStart(2)} need=${String(def.exp_to_next_level).padStart(6)}  ${desc}`);
}
console.log('\ntotal levels:', Object.keys(levels).length);
