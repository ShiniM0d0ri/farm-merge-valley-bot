// scratch/timer_labels.js - every distinct timer label ever written, with its duration.
//
// Timer labels are the naming convention for a timer's owner (`MapSourceCooldown:r,c`,
// `Order_<building>`, `Cooldown_<building>`, `regenerate_<name>`, ...), so this is the fastest way
// to find the label used for a mechanic. Point it at har_saves*.json.
import fs from 'node:fs';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['har_saves.json', 'har_saves_levelup.json'];
const seen = new Map();

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const saves = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of saves) {
    const timers = s.models.TimerModel?.json?.data?.timers;
    if (!Array.isArray(timers)) continue;
    for (const t of timers) {
      const base = String(t.label).replace(/:?\d+,\d+$/, ':<r,c>');
      const key = `${base}  dur=${t.duration}`;
      if (!seen.has(key)) seen.set(key, { label: t.label, duration: t.duration, state: t.state, src: t.timeSource, file: f, seq: s.seq });
    }
  }
}

const rows = [...seen.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
console.log(`${rows.length} distinct label/duration pair(s)\n`);
for (const r of rows) {
  console.log(
    `  ${String(r.label).padEnd(44)} dur ${String(r.duration).padStart(12)} ms ` +
    `${String(r.duration / 60000).padStart(8)} min  src ${r.src}  (${r.file} save ${r.seq})`
  );
}
