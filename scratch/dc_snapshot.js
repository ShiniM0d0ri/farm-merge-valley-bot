import '../lib/env.js';
// scratch/dc_snapshot.js - the full DailyChallengeModel targets as a given capture save wrote them.
// Used to lift real before/after fixtures into scratch/test_daily.js.
//
//   FMV_IN=har_saves.json node scratch/dc_snapshot.js 13 14
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const want = new Set(process.argv.slice(2).map(Number));
let cur = null;
for (const s of saves) {
  if (s.models.DailyChallengeModel) cur = s.models.DailyChallengeModel.json;
  if (want.has(s.seq)) {
    console.log(`\n--- save ${s.seq} (t=${s.t}) ---`);
    console.log(JSON.stringify(cur));
  }
}
