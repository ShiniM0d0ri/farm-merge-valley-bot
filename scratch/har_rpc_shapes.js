import '../lib/env.js';
import fs from 'node:fs';
const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
const seen = new Map();
for (const e of har.log.entries) {
  const url = e.request?.url || '';
  if (!/rpc/i.test(url)) continue;
  const name = url.split('/').pop().split('?')[0];
  const ct = e.response?.content?.mimeType || '';
  const len = e.response?.content?.text?.length ?? -1;
  const size = e.response?.content?.size ?? -1;
  const enc = e.response?.content?.encoding || '';
  const key = `${name} ${ct} ${enc}`;
  if (!seen.has(key)) seen.set(key, { n: 0, len, size, sample: (e.response?.content?.text || '').slice(0, 60) });
  seen.get(key).n++;
}
for (const [k, v] of seen) console.log(`${String(v.n).padStart(4)}x  ${k}  len=${v.len} size=${v.size}\n      ${JSON.stringify(v.sample)}`);
console.log('\n--- all distinct URL tails ---');
const tails = new Map();
for (const e of har.log.entries) {
  const u = e.request?.url || '';
  const m = /rpc\/([A-Za-z0-9_]+)/.exec(u);
  if (m) tails.set(m[1], (tails.get(m[1]) || 0) + 1);
}
console.log([...tails.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}x${v}`).join('\n'));
