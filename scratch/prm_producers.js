import '../lib/env.js';
// scratch/prm_producers.js - decode PseudoRandomnessModel's role for tier-4 producers.
//
// A producer tile is written as {"cooldown":{"timerId":2129},...} but timer 2129 exists in no
// TimerModel snapshot, while PseudoRandomnessModel *does* carry chicken_4/cow_4/wheat_4/carrot_4/
// sugarcane_4/goat_4. So this is where production timing must live. Print its shape.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const PRODUCERS = /chicken_4|cow_4|wheat_4|carrot_4|sugarcane_4|goat_4/;

let prm = null;
let seq = null;
for (const x of saves) {
  if (x.models.PseudoRandomnessModel) { prm = x.models.PseudoRandomnessModel.json.data; seq = x.seq; }
}
if (!prm) { console.log('no PseudoRandomnessModel'); process.exit(1); }

const d = prm.data || prm;
console.log(`PseudoRandomnessModel from save ${seq}`);
console.log(`model keys  : ${Object.keys(prm).join(', ')}`);
console.log(`data keys   : ${Object.keys(d).slice(0, 30).join(' | ')}`);
console.log('');

for (const k of Object.keys(d)) {
  const v = JSON.stringify(d[k] === undefined ? '' : d[k]);
  if (PRODUCERS.test(v)) {
    console.log(`KEY "${k}"  (${v.length} chars)`);
    console.log(v.slice(0, 900));
    console.log('');
  }
}

// Also: does any producer tile on the board carry a timestamp we missed?
console.log('=== a producer tile exactly as stored (last save that has one) ===');
for (let i = saves.length - 1; i >= 0; i--) {
  const hit = Object.entries(saves[i].models).find(
    ([key, m]) => key.startsWith('TilesStateModel_') && /_4$/.test(m.json?.data?.state?.blueprint || '')
  );
  if (hit) {
    console.log(`save ${saves[i].seq}  ${hit[0]}`);
    console.log(JSON.stringify(hit[1].json, null, 1));
    break;
  }
}
