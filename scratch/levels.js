// scratch/levels.js - exp thresholds + rewards around the current level.
import fs from 'node:fs';
const prog = JSON.parse(fs.readFileSync('../fmv_cfg/progression_jsonpack.json', 'utf8'));
const root = prog.data ?? prog;
const levels = root.progression_per_level?.levels ?? root.levels ?? root;
const keys = Object.keys(levels).sort((a, b) => Number(a) - Number(b));
console.log('level keys:', keys.slice(0, 5).join(','), '...', keys.slice(-3).join(','));
const sample = levels[keys[0]];
console.log('sample level fields:', Object.keys(sample).join(', '));
let cum = 0;
for (const k of keys) {
  const n = Number(k);
  const l = levels[k];
  cum += l.exp_to_next_level ?? 0;
  if (n < 12 || n > 18) continue;
  console.log(`L${k}: exp_to_next=${l.exp_to_next_level}  cumulative_to_reach_L${n + 1}=${cum}  rewards=${JSON.stringify(l.rewards)}`);
}
