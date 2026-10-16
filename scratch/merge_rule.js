// scratch/merge_rule.js - pin the merge rule from the captures by COUNT deltas (drags cancel out).
//
// For each save: net tile-count delta per blueprint over the whole board + the exp delta. A merge of
// 3 identical X is `X -3, target(X) +1, exp += expReward(X)`; a 5-merge would be `X -5, target +2`.
// Anything else (crate spawns, loot, collects, drags) shows as its own pattern, so the merge multiset
// is recoverable by solving from the lowest tier upwards.
//
//   FMV_IN=har_saves_levelup.json node scratch/merge_rule.js
import fs from 'node:fs';
import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';

const bps = loadBlueprints();
const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));

const bpOf = (json) => json?.data?.state?.blueprint ?? null;
const tgt = (bp) => resolveBlueprint(bps, bp)?.mergeable?.target ?? null;
const expOf = (bp) => resolveBlueprint(bps, bp)?.mergeable?.expReward ?? null;

const tiles = new Map();          // key -> blueprint (reconstructed)
const counts = new Map();         // blueprint -> n
const add = (bp, n) => counts.set(bp, (counts.get(bp) || 0) + n);

console.log(`save 0 carries ${Object.keys(saves[0].models).filter((k) => k.startsWith('TilesStateModel_')).length} tiles`);
console.log(`total distinct tile keys seen in capture: ${new Set(saves.flatMap((s) => Object.keys(s.models).filter((k) => k.startsWith('TilesStateModel_')))).size}`);

let prevExp = null;
for (const s of saves) {
  const before = new Map(counts);
  for (const [k, m] of Object.entries(s.models)) {
    if (!k.startsWith('TilesStateModel_')) continue;
    const old = tiles.get(k) ?? null;
    const now = bpOf(m.json);
    if (old === now) continue;
    if (old) add(old, -1);
    if (now) add(now, +1);
    tiles.set(k, now);
  }
  const exp = s.models.InventoryModel?.json?.data?.exp ?? null;
  const expDelta = (exp !== null && prevExp !== null) ? exp - prevExp : null;
  if (exp !== null) prevExp = exp;

  // blueprint deltas, ignoring nothing - we want the raw picture
  const deltas = [];
  for (const [bp, n] of counts) {
    const d = n - (before.get(bp) || 0);
    if (d) deltas.push(`${bp} ${d > 0 ? '+' : ''}${d}`);
  }
  const lost = deltas.filter((d) => / -\d/.test(d));
  if (!lost.length && !expDelta) continue;

  console.log(`\n[save ${String(s.seq).padStart(3)}] exp delta ${expDelta === null ? '?' : (expDelta > 0 ? '+' : '') + expDelta}`);
  console.log(`   ${deltas.join('  ')}`);
  if (expDelta) {
    // what multiset of merges explains this exp?
    const cands = lost.map((d) => d.split(' ')[0]).filter((bp) => expOf(bp));
    console.log(`   expRewards of the blueprints that lost tiles: ${cands.map((bp) => `${bp}=${expOf(bp)}`).join(' ')}`);
  }
}
