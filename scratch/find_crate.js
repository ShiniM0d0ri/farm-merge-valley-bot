// scratch/find_crate.js - print SAVE blocks that mention reward_crate, plus key/timer context.
import fs from 'node:fs';

const raw = fs.readFileSync('transitions.txt', 'utf8').split(/\r?\n/);
// split into blocks on the ====== SAVE [...] ====== header
const blocks = [];
let cur = null;
for (const line of raw) {
  if (/^=+ *SAVE \[/.test(line)) {
    cur = { header: line.trim(), lines: [] };
    blocks.push(cur);
  } else if (cur) cur.lines.push(line);
}

const trim = (s, n = 200) => (s.length > n ? s.slice(0, n) + ` …(+${s.length - n})` : s);

let hits = 0;
for (const b of blocks) {
  const txt = b.lines.join('\n');
  if (!/reward_crate/.test(txt)) continue;
  hits++;
  console.log(`\n#### ${b.header}`);
  for (const l of b.lines) {
    if (/reward_crate|rewardCrate|key|Key/.test(l)) {
      console.log('   ' + trim(l.trim()));
    }
  }
}
console.log(`\n(${hits} blocks mention reward_crate of ${blocks.length})`);
