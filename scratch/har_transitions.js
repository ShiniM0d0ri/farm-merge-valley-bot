import '../lib/env.js';
// Replay HAR saves cumulatively, printing what each one changed.
// Saves are partial (only touched models), so we keep a running state and diff.
import fs from 'node:fs';

const saves = JSON.parse(fs.readFileSync(process.env.FMV_IN || 'har_saves.json', 'utf8'));
const J = (m) => (m ? JSON.stringify(m.json) : '(absent)');
const short = (s, n = 420) => (s && s.length > n ? s.slice(0, n) + ` …(+${s.length - n})` : s);

const state = {};
const out = [];

saves.forEach((s, i) => {
  const lines = [`\n================ SAVE [${i}] ${s.src} ${s.t} ================`];
  for (const [k, m] of Object.entries(s.models)) {
    const before = state[k];
    const a = J(before), b = J(m);
    if (a === b) continue;
    lines.push(`\n  * ${k}`);
    if (before === undefined) lines.push(`      NEW: ${short(b)}`);
    else lines.push(`      - ${short(a)}\n      + ${short(b)}`);
    state[k] = m;
  }
  if (lines.length > 1) out.push(lines.join('\n'));
});

const OUT = process.env.FMV_TRANS || 'transitions.txt';
fs.writeFileSync(OUT, out.join('\n'));
console.log(`wrote ${OUT} (${out.length} non-trivial saves of ${saves.length})`);
