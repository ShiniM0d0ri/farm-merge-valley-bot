// scratch/bonus_merge.js - find the saves where UserStatsModel.totalBonusMerges increments and dump
// the tile changes around them. That pins what a "bonus merge" is (5 tiles -> 2 outputs?) and how the
// game counts it.
//
//   FMV_IN=har_saves_levelup.json node scratch/bonus_merge.js
import fs from 'node:fs';
import { loadBlueprints, resolveBlueprint } from '../lib/blueprints.js';

const bps = loadBlueprints();
const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));
const bpOf = (json) => json?.data?.state?.blueprint ?? null;
const expOf = (bp) => resolveBlueprint(bps, bp)?.mergeable?.expReward ?? null;
const tgtOf = (bp) => resolveBlueprint(bps, bp)?.mergeable?.target ?? null;

const KEYS = ['totalNormalMerges', 'totalBonusMerges', 'totalMergedCrops', 'totalMergedAnimals', 'totalHarvestedItems', 'totalCompletedOrders'];
const tiles = new Map();
let prev = null;
let prevExp = null;

for (const s of saves) {
  const st = s.models.UserStatsModel?.json?.data;
  const exp = s.models.InventoryModel?.json?.data?.exp ?? null;
  const changes = st && prev ? KEYS.filter((k) => prev[k] !== st[k]).map((k) => `${k} ${prev[k]}->${st[k]}`) : [];
  const expDelta = exp !== null && prevExp !== null ? exp - prevExp : null;
  if (exp !== null) prevExp = exp;

  if (changes.some((c) => c.startsWith('totalBonusMerges'))) {
    console.log(`\n===== save ${s.seq}: ${changes.join(' | ')}   exp ${expDelta >= 0 ? '+' : ''}${expDelta}`);
    const consumed = [], changed = [], appeared = [];
    for (const [k, m] of Object.entries(s.models)) {
      if (!k.startsWith('TilesStateModel_')) continue;
      const before = tiles.get(k) ?? null;
      const after = bpOf(m.json);
      if (before === after) continue;
      const at = k.replace('TilesStateModel_', '').replace(':', ',');
      if (before && !after) consumed.push(`${before}@${at}`);
      else if (!before && after) appeared.push(`${after}@${at}`);
      else changed.push(`${before}->${after}@${at}`);
      tiles.set(k, after);
    }
    console.log(`   consumed ${consumed.length}: ${consumed.join(' ')}`);
    console.log(`   changed  ${changed.length}: ${changed.join(' ')}`);
    console.log(`   appeared ${appeared.length}: ${appeared.join(' ')}`);
    // per-blueprint tally of the consumed tiles, with the exp each would pay
    const tally = {};
    for (const c of consumed) { const bp = c.split('@')[0]; tally[bp] = (tally[bp] || 0) + 1; }
    console.log(`   consumed by blueprint: ${Object.entries(tally).map(([bp, n]) => `${bp} x${n} (exp ${expOf(bp)})`).join(', ')}`);
  }
  if (st) prev = st;
}
