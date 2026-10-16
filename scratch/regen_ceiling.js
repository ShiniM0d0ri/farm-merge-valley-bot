// scratch/regen_ceiling.js - what is the empirical ceiling for regenerated crates/energy/gems?
//
// The user says the crate/energy auto-refresh stops at a max ("doesn't increase with time if it's
// more than max"). We need that number to cap catch-up grants. Look at the maximum value each
// counter ever reached across both HARs, and how often it sat there while a generator was overdue.
import fs from 'node:fs';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['har_saves_levelup.json', 'har_saves.json'];
const KEYS = ['crates', 'energy', 'gems', 'coins', 'time_limited_event_energy', 'tickets'];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const saves = JSON.parse(fs.readFileSync(f, 'utf8'));
  const max = {};
  const hist = {};
  for (const s of saves) {
    const inv = s.models.InventoryModel?.json?.data;
    if (!inv) continue;
    for (const k of KEYS) {
      if (typeof inv[k] !== 'number') continue;
      max[k] = Math.max(max[k] ?? -Infinity, inv[k]);
      hist[k] = hist[k] || new Map();
      hist[k].set(inv[k], (hist[k].get(inv[k]) || 0) + 1);
    }
  }
  console.log(`### ${f}  (${saves.length} saves)`);
  for (const k of KEYS) {
    if (max[k] === undefined) continue;
    const top = [...hist[k].entries()].sort((a, b) => b[0] - a[0]).slice(0, 4)
      .map(([v, n]) => `${v}x${n}`).join('  ');
    console.log(`  ${k.padEnd(26)} max ${String(max[k]).padStart(4)}   top values: ${top}`);
  }
  console.log('');
}
