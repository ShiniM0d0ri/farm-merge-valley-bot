// scratch/why_no_merge.js - why did a board that looks like it has groups of 3 plan no merges?
//
// Prints every blueprint on the board with its count and whether its tiles actually carry the
// `mergeable` component (a tile can exist without it: resource nodes, depleted tiles, tiles on
// cooldown). Run from the repo root against state.json (written by the last bot.js read).
import fs from 'node:fs';
import { tiles } from '../lib/board.js';

const models = JSON.parse(fs.readFileSync(process.env.FMV_STATE || 'state.json', 'utf8'));
const groups = new Map();

for (const v of tiles(models).values()) {
  if (!v || !v.blueprint) continue;
  const key = v.blueprint;
  if (!groups.has(key)) groups.set(key, { n: 0, mergeable: 0, targets: new Set(), keys: [] });
  const g = groups.get(key);
  g.n++;
  if (v.data?.mergeable) { g.mergeable++; g.targets.add(v.data.mergeable.target); }
  g.keys.push(v.key);
}

const rows = [...groups.entries()].sort((a, b) => b[1].n - a[1].n);
console.log('blueprint                     tiles  mergeable  target');
for (const [bp, g] of rows) {
  const flag = g.n >= 3 && g.mergeable < 3 ? '   <-- LOOKS mergeable but is not' : '';
  console.log(
    `${bp.padEnd(28)} ${String(g.n).padStart(5)} ${String(g.mergeable).padStart(10)}  ` +
    `${[...g.targets].join(',') || '-'}${flag}`
  );
}

const blocked = rows.filter(([, g]) => g.n >= 3 && g.mergeable === 0);
console.log(`\n${blocked.length} blueprint(s) with >=3 tiles but 0 mergeable`);
