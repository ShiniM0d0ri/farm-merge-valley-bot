import '../lib/env.js';
// scratch/timer_list2.js - print the final TimerModel as a table (id, label, duration, state).
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves_levelup.json', 'utf8'));
let tm = null;
for (const s of saves) if (s.models.TimerModel) tm = s.models.TimerModel.json.data;
if (!tm) { console.log('no TimerModel'); process.exit(1); }

const want = process.argv[2];
const rows = (tm.timers || [])
  .filter((t) => !want || String(t.label).toLowerCase().includes(want.toLowerCase()) || String(t.id) === want)
  .sort((a, b) => a.id - b.id);

console.log(`nextTimerId=${tm.nextTimerId}, ${rows.length} timer(s)`);
for (const t of rows) {
  const end = t.started + t.duration;
  console.log(
    `  id ${String(t.id).padStart(5)}  ${String(t.label).padEnd(34)} dur ${String(t.duration).padStart(12)} ms ` +
    `(${(t.duration / 60000).toFixed(1)} min)  state ${t.state}`
  );
}
