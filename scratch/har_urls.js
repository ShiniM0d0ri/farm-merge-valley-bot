import '../lib/env.js';
import fs from 'node:fs';
const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
console.log('entries:', har.log.entries.length);
const byHost = new Map();
for (const e of har.log.entries) {
  const u = e.request?.url || '(none)';
  let host = '(none)';
  try { host = new URL(u).host; } catch {}
  if (!byHost.has(host)) byHost.set(host, new Map());
  const m = /^[a-z]+:\/\/[^/]+(\/[^?]*)/.exec(u);
  const path = m ? m[1] : u;
  const key = path.replace(/[0-9a-f-]{8,}/gi, '<id>').split('/').slice(0, 4).join('/');
  const map = byHost.get(host);
  map.set(key, (map.get(key) || 0) + 1);
}
for (const [host, paths] of byHost) {
  console.log(`\n${host}`);
  for (const [p, n] of paths) console.log(`  ${String(n).padStart(5)}x ${p}`);
}
