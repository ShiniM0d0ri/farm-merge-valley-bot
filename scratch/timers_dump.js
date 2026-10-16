// scratch/timers_dump.js - print TimerModel (all live timers) compactly.
import fs from 'node:fs';

const models = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const tm = models.TimerModel?.json?.data;
console.log('TimerModel type:', Array.isArray(tm) ? 'array' : typeof tm);
const entries = Array.isArray(tm) ? tm.map((t, i) => [String(i), t]) : Object.entries(tm || {});
console.log('count:', entries.length);
for (const [k, t] of entries) {
  const s = JSON.stringify(t);
  console.log(`  ${k}: ${s.length > 300 ? s.slice(0, 300) + '…' : s}`);
}
