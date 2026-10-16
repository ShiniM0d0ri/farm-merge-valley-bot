import '../lib/env.js';
// scratch/har_rpcs.js - list every distinct request URL/path + method from the HAR.
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8'));
const entries = har.log?.entries || [];
console.log('entries:', entries.length);
const map = new Map();
for (const e of entries) {
  let u;
  try { u = new URL(e.request.url); } catch { continue; }
  const key = `${e.request.method} ${u.host}${u.pathname}`;
  map.set(key, (map.get(key) || 0) + 1);
}
for (const [k, n] of [...map.entries()].sort()) console.log(`${String(n).padStart(4)}  ${k}`);
