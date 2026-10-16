// Replay saves; print the TimerModel entries created by the resource-work action,
// plus final OrdersModel / GameWorkersModel / a PseudoRandomnessModel sample.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync('har_saves.json', 'utf8'));
const state = {};

for (const s of saves) {
  for (const [k, m] of Object.entries(s.models)) {
    const before = JSON.stringify(state[k]?.json);
    const after = JSON.stringify(m.json);
    if (before === after) continue;

    // report newly appearing timers
    if (k === 'TimerModel') {
      const bt = state[k]?.json?.data?.timers || [];
      const at = m.json?.data?.timers || [];
      const seen = new Set(bt.map((t) => t.id));
      const fresh = at.filter((t) => !seen.has(t.id));
      if (fresh.length) {
        console.log(`\n=== TimerModel: ${fresh.length} new timer(s) ===`);
        for (const t of fresh) console.log('  ' + JSON.stringify(t));
      }
      const gone = bt.filter((t) => !at.some((x) => x.id === t.id));
      if (gone.length) {
        console.log(`  removed timers: ${gone.map((t) => t.id).join(', ')}`);
        for (const t of gone) console.log('    ' + JSON.stringify(t));
      }
    }
    state[k] = m;
  }
}

console.log('\n\n=== final TimerModel.data.timers (labels only) ===');
for (const t of state.TimerModel?.json?.data?.timers || []) {
  console.log(`  id=${t.id} label=${t.label} state=${t.state} duration=${t.duration} src=${t.timeSource}`);
}
console.log('\n=== GameWorkersModel ===');
console.log(JSON.stringify(state.GameWorkersModel?.json, null, 1));
console.log('\n=== OrdersModel ===');
console.log(JSON.stringify(state.OrdersModel?.json, null, 1));
console.log('\n=== PseudoRandomnessModel (first entry) ===');
const pr = state.PseudoRandomnessModel?.json?.data?.data;
if (Array.isArray(pr)) console.log(JSON.stringify(pr[0], null, 1));
