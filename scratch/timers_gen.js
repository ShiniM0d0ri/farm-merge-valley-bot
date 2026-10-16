import fs from 'node:fs';

const sm = JSON.parse(fs.readFileSync('./config/state_models_full.json', 'utf8'));
const tm = sm.TimerModel;
console.log('TimerModel keys:', Object.keys(tm || {}));
const data = tm?.json?.data ?? tm?.data;
console.log('shape:', JSON.stringify(data).slice(0, 200));

const timers = data?.timers;
if (Array.isArray(timers)) {
  console.log(`\nnextTimerId=${data.nextTimerId} count=${timers.length}`);
  console.log('\ntimers matching generator/interval/regen:');
  for (const t of timers) {
    if (/generator|interval|regen|auto/i.test(t.label || '')) console.log(`  ${t.id} ${t.label} dur=${t.duration} state=${t.state} started=${t.started}`);
  }
  const byLabel = {};
  for (const t of timers) {
    const base = String(t.label || '').replace(/[:_].*$/, '');
    byLabel[base] = (byLabel[base] || 0) + 1;
  }
  console.log('\nlabel families (count, sample duration):');
  for (const [k, n] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) {
    const s = timers.find((t) => String(t.label || '').startsWith(k));
    console.log(`  ${String(k).padEnd(30)} x${String(n).padStart(3)}  dur=${s?.duration}`);
  }
}
