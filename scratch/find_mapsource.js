// Every timer labelled MapSource* across all HAR saves, to settle the duration question.
import fs from 'node:fs';
const saves = JSON.parse(fs.readFileSync('har_saves.json', 'utf8'));
const seen = new Map();
for (const s of saves) {
  const t = s.models.TimerModel?.json?.data?.timers;
  if (!t) continue;
  for (const x of t) {
    if (String(x.label).startsWith('MapSource')) seen.set(x.id, x);
  }
}
console.log(`MapSource timers found: ${seen.size}`);
for (const x of seen.values()) console.log('  ' + JSON.stringify(x));
