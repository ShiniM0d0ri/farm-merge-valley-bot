import '../lib/env.js';
// scratch/analytics_pair.js - the AnalyticsModel delta of a given capture save, next to the tiles that
// changed. Used to decide whether the counters the bot should mirror (harvestTaps, orderStarted,
// orderCollected) really are one-per-action.
//
//   FMV_IN=har_saves.json node scratch/analytics_pair.js 14 19
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const want = new Set(process.argv.slice(2).map(Number));
let prev = null;

const delta = (a, b) => {
  const out = [];
  if (!a || !b) return ['(no previous snapshot)'];
  const flat = (o, p = '') => Object.fromEntries(Object.entries(o || {}).flatMap(([k, v]) =>
    (v && typeof v === 'object' && !Array.isArray(v)) ? Object.entries(flat(v, `${p}${k}.`)) : [[p + k, v]]));
  const fa = flat(a), fb = flat(b);
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (fa[k] !== fb[k]) out.push(`${k}: ${JSON.stringify(fa[k])} -> ${JSON.stringify(fb[k])}`);
  }
  return out;
};

for (const s of saves) {
  const a = s.models.AnalyticsModel?.json?.data;
  if (s.models.AnalyticsModel && want.has(s.seq)) {
    console.log(`\n--- save ${s.seq} ---`);
    console.log(`  tiles written: ${Object.keys(s.models).filter((k) => k.startsWith('TilesStateModel_')).length}`);
    for (const d of delta(prev, a)) console.log(`  A ${d}`);
  }
  if (a) prev = a;
}
