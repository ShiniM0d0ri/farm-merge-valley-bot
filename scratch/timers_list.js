// scratch/timers_list.js - all live timers, id/label/state/duration.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const tm = models.TimerModel?.json?.data;
console.log('nextTimerId =', tm.nextTimerId, ' count =', tm.timers.length);
for (const t of tm.timers) {
  const extra = Object.keys(t).filter((k) => !['id', 'label', 'state', 'started', 'duration'].includes(k));
  console.log(`  ${String(t.id).padStart(5)}  ${t.state.padEnd(8)} dur=${String(t.duration).padStart(10)}  ${t.label}` + (extra.length ? `  +${extra.join(',')}` : ''));
}
