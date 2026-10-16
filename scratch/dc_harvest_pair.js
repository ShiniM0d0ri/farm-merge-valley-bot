import '../lib/env.js';
// scratch/dc_harvest_pair.js - for the saves where DailyChallengeModel "harvest" advanced, show the
// FULL inventory delta (every key) and the before/after JSON of the tiles that changed. Pins what the
// counter actually counts.
//
//   FMV_IN=har_saves.json node scratch/dc_harvest_pair.js 14 19
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const want = new Set(process.argv.slice(2).map(Number));

const lastInv = new Map();  // save seq -> inv
const lastTiles = new Map();
let prevInv = null;
let prevTiles = null;

const invDelta = (a, b) => {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push(`${k}: ${JSON.stringify(a?.[k])} -> ${JSON.stringify(b?.[k])}`);
  }
  return out;
};

for (const s of saves) {
  const inv = { ...(prevInv || {}), ...(s.models.InventoryModel?.json?.data || {}) };
  const tiles = { ...(prevTiles || {}) };
  for (const [k, m] of Object.entries(s.models)) {
    if (k.startsWith('TilesStateModel_')) tiles[k] = m.json;
    else if (k === 'TilesStateModel') tiles.__root = m.json;
  }

  if (want.has(s.seq)) {
    const d = invDelta(prevInv, inv);
    console.log(`\n===== save ${s.seq}  t=${s.t} =====`);
    console.log(`full inventory delta (${d.length}):`);
    d.forEach((x) => console.log(`   ${x}`));
    const dc = s.models.DailyChallengeModel?.json?.data?.targets || [];
    console.log(`DC harvest targets: ${dc.filter((t) => t.task === 'harvest').map((t) => `#${t.id} ${t.currentAmount}/${t.targetAmount}`).join(', ')}`);
    const tileKeys = Object.keys(s.models).filter((k) => k.startsWith('TilesStateModel_'));
    console.log(`tiles written in this save (${tileKeys.length}):`);
    for (const k of tileKeys) {
      console.log(`   ${k.replace('TilesStateModel_', '').replace(':', ',')}`);
      console.log(`      before: ${JSON.stringify(prevTiles?.[k])}`);
      console.log(`      after : ${JSON.stringify(s.models[k].json)}`);
    }
    console.log(`other models: ${Object.keys(s.models).filter((k) => !k.startsWith('TilesStateModel_')).join(' ')}`);
  }

  prevInv = inv;
  for (const [k, m] of Object.entries(s.models)) if (k.startsWith('TilesStateModel_')) prevTiles = { ...(prevTiles || {}), [k]: m.json };
}
