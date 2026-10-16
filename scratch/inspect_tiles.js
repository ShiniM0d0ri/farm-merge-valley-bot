// Dump tile details: which components each tile carries, so we can find harvest/collect paths.
import fs from 'node:fs';
import { tiles } from '../lib/board.js';

const m = JSON.parse(fs.readFileSync('state.json', 'utf8'));

const byKey = new Map();
for (const v of tiles(m).values()) {
  if (!v) continue;
  const d = v.data || {};
  const keys = Object.keys(d).sort().join(',') || '(none)';
  if (!byKey.has(keys)) byKey.set(keys, []);
  byKey.get(keys).push(v);
}

const rows = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length);
for (const [keys, list] of rows) {
  const names = [...new Set(list.map((v) => v.blueprint))];
  console.log(`\n[${list.length}] components: ${keys}`);
  console.log(`    ${names.join(', ').slice(0, 300)}`);
}

const all = [...tiles(m).values()].filter(Boolean);

for (const [label, pred] of [
  ['cooldown', (v) => v.data?.cooldown],
  ['collectable', (v) => v.data?.collectable],
  ['crateReward', (v) => v.data?.crateReward],
  ['currency', (v) => v.data?.currency],
  ['lootable', (v) => v.data?.lootable],
  ['depleted', (v) => v.data?.depleted],
  ['hitpoints', (v) => v.data?.hitpoints],
  ['resourceGate', (v) => v.data?.resourceGate],
  ['upgradeCard', (v) => v.data?.upgradeCard],
]) {
  const hit = all.filter(pred);
  if (!hit.length) { console.log(`\n=== ${label}: none on board ===`); continue; }
  const v = hit[0];
  console.log(`\n=== ${label}: ${hit.length} tile(s); sample ${v.blueprint} @ (${v.row},${v.col}) ===`);
  console.log(JSON.stringify(v.raw, null, 1).slice(0, 1200));
}
