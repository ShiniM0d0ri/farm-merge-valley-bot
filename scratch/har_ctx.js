import '../lib/env.js';
// scratch/har_ctx.js - print context around a substring in the HAR.
import fs from 'node:fs';
const t = fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8');
const needle = process.argv[2] || 'single_socket';
const before = Number(process.argv[3] || 300);
const after = Number(process.argv[4] || 400);
let i = -1, n = 0;
while ((i = t.indexOf(needle, i + 1)) !== -1 && n < 12) {
  n++;
  console.log(`\n--- hit ${n} @${i} ---`);
  console.log(t.slice(Math.max(0, i - before), i + after).replace(/\\n/g, '\n'));
}
console.log(`\n(${n} hits)`);
