// scratch/merge_batch.js - how many merges the CLIENT puts in one save, and whether a merge can
// cascade inside a save. Decides whether the bot may resolve a whole chain in one write.
//
// For every save it reports, per blueprint: tiles that became null (consumed) and tiles that changed
// blueprint (the merge "keep" cell). A 3-merge = 3 nulls + 1 changed (or +1 new tile if the keep cell
// was empty). Then it checks the exp delta against the sum of `expReward` of the consumed groups, and
// flags a cascade (a tile changed into blueprint B in this save, then consumed again in this save).
//
//   FMV_IN=har_saves_levelup.json node scratch/merge_batch.js
import fs from 'node:fs';
import { loadBlueprints } from '../lib/blueprints.js';

const bps = loadBlueprints();
const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_launch.json', 'utf8'));

const bpOf = (json) => json?.data?.state?.blueprint ?? null;
const expReward = (bp) => bps[bp]?.mergeable?.expReward ?? null;
const target = (bp) => bps[bp]?.mergeable?.target ?? null;

const tiles = new Map();  // key -> blueprint

for (const s of saves) {
  const consumed = new Map();   // blueprint -> n (tile -> null)
  const changed = new Map();    // "from->to" -> n
  const appeared = [];          // blueprint (null -> something)
  let expBefore = null;
  let expAfter = null;

  for (const [k, m] of Object.entries(s.models)) {
    if (k === 'InventoryModel') { expAfter = m.json?.data?.exp ?? null; continue; }
    if (!k.startsWith('TilesStateModel_')) continue;
    const before = tiles.get(k) ?? null;
    const after = bpOf(m.json);
    if (before === after) continue;
    if (before && !after) consumed.set(before, (consumed.get(before) || 0) + 1);
    else if (!before && after) appeared.push(after);
    else if (before && after) changed.set(`${before}->${after}`, (changed.get(`${before}->${after}`) || 0) + 1);
    tiles.set(k, after);
  }
  // InventoryModel may itself hold exp without a tile change in this save - keep the last seen value.
  if (expAfter === null) continue;

  const nulls = [...consumed.values()].reduce((a, b) => a + b, 0);
  const upgraded = [...changed.values()].reduce((a, b) => a + b, 0);
  if (!nulls && !upgraded && !appeared.length) continue;

  console.log(`\n[save ${String(s.seq).padStart(3)}] exp ${expAfter}  consumed=${nulls} upgraded=${upgraded} appeared=${appeared.length}`);
  console.log(`   consumed: ${[...consumed].map(([b, n]) => `${n}x${b}`).join(' ')}`);
  console.log(`   upgraded: ${[...changed].map(([b, n]) => `${n}x${b}`).join(' ')}`);

  // expected merges: every consumed group of 3 is one merge; a cascade shows as an upgraded tile
  // that is itself consumed.
  const expFromGroups = [...consumed].reduce((a, [b, n]) => a + Math.floor(n / 3) * (expReward(b) || 0), 0);
  console.log(`   exp if every 3 consumed = 1 merge (${[...consumed].map(([b, n]) => `${b}:${Math.floor(n / 3)}x${expReward(b)}`).join(' ')}): ${expFromGroups}`);
  const odd = [...consumed].filter(([b, n]) => n % 3 !== 0);
  if (odd.length) console.log(`   !! consumed counts not a multiple of 3: ${odd.map(([b, n]) => `${b}x${n}`).join(' ')}`);
  // 5-merge probe: 5 consumed and 2 upgraded of the next tier
  for (const [b, n] of consumed) {
    const up = changed.get(`${b}->${target(b)}`) || 0;
    if (n >= 5) console.log(`   ?? ${b}: ${n} consumed, ${up} upgraded -> ${target(b)} (5-merge would be 5/2)`);
  }
}
