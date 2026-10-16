import '../lib/env.js';
// scratch/producer_timer.js - where does a tier-4 producer's production timing actually live?
//
// The launch HAR writes a NEW producer as
//   {"cooldown":{"timerId":2129},"hitpoints":{"startAsVisible":false,"max":1,"current":2}}
// but timer ids 2115/2116/2120/2123/2126/2129 appear in NO TimerModel snapshot. So either the
// reference is dangling, or the real timing lives somewhere else (PseudoRandomnessModel carries
// matching `*_4` contexts per MECHANICS section 4). This prints every candidate.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));

// 1. the save that creates a producer tile, and what it changed
console.log('=== saves that create a tier-4 producer ===');
for (const s of saves) {
  for (const [key, m] of Object.entries(s.models)) {
    if (!key.startsWith('TilesStateModel_')) continue;
    const st = m.json?.data?.state;
    if (!st || !/_4$/.test(st.blueprint || '')) continue;
    if (!st.data?.cooldown) continue;
    console.log(`save ${s.seq}  ${key}  ${st.blueprint}  timerId ${st.data.cooldown.timerId}`);
    console.log(`   models changed: ${Object.keys(s.models).join(', ').slice(0, 300)}`);
    const t = s.models.TimerModel?.json?.data;
    console.log(`   TimerModel in save: ${t ? `yes, nextTimerId ${t.nextTimerId}, ${t.timers.length} timers` : 'NO'}`);
  }
}

// 2. any timer id in the range the producers reference
console.log('\n=== timer ids 2100-2140 ever present ===');
const found = new Set();
for (const s of saves) {
  for (const t of s.models.TimerModel?.json?.data?.timers || []) {
    if (t.id >= 2100 && t.id <= 2140) found.add(`${t.id} label=${JSON.stringify(t.label)} dur=${t.duration}`);
  }
}
console.log(found.size ? [...found].join('\n') : '(none - the reference is dangling)');

// 3. PseudoRandomnessModel: does it hold producer contexts?
console.log('\n=== PseudoRandomnessModel keys mentioning producers ===');
let prm = null;
for (const s of saves) if (s.models.PseudoRandomnessModel) prm = s.models.PseudoRandomnessModel.json.data;
if (!prm) console.log('(no PseudoRandomnessModel)');
else {
  const keys = Object.keys(prm);
  console.log(`${keys.length} top-level key(s): ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' ...' : ''}`);
  const json = JSON.stringify(prm);
  const hits = [...json.matchAll(/"[^"]*(chicken_4|cow_4|wheat_4|carrot_4|sugarcane_4|goat_4)[^"]*"/g)].map((m) => m[0]);
  console.log(hits.length ? `producer mentions: ${[...new Set(hits)].slice(0, 10).join(', ')}` : 'no producer mentions');
}
