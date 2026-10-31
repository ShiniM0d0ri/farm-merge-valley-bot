// scratch/probe_har_headers_replay.js - replay the capture's exact header set for authenticate/custom.
//
// The sanitized capture kept every header except Authorization/Cookie. If Discord's side injects the
// key based on the client fingerprint, replaying the full set should authenticate us; if it still
// answers "Server key required", the browser must have sent Basic and the export stripped it.
//
// Safe: create=false with an id that does not exist, so nothing can be created or disturbed.
import fs from 'node:fs';
import { loadSession, httpBase } from '../lib/nakama.js';

const HAR = process.env.FMV_HAR || `${process.env.USERPROFILE}\\Downloads\\farm_merge_launch.har`;
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const entry = (har.log?.entries || []).find((e) => /authenticate\/custom/.test(e.request?.url || ''));
if (!entry) {
  console.log('no authenticate/custom entry in this capture');
  process.exit(1);
}

const s = loadSession();
const SKIP = new Set(['content-length', 'authorization', 'cookie', 'host', 'connection']);

const headers = {};
for (const h of entry.request.headers || []) {
  const n = String(h.name);
  if (n.startsWith(':') || SKIP.has(n.toLowerCase())) continue;
  headers[n] = String(h.value);
}

console.log('replaying these headers (values masked):');
for (const [k, v] of Object.entries(headers)) console.log(`  ${k}: ${v.slice(0, 60)}${v.length > 60 ? '…' : ''}`);

const url = `${httpBase(s)}/v2/account/authenticate/custom?create=false&username=probe-does-not-exist`;
const r = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ id: 'probe-does-not-exist-0000', vars: {} }),
});
const t = await r.text();
console.log(`\nHTTP ${r.status}  ${t.slice(0, 200)}`);
console.log(r.status === 401
  ? '\n-> still rejected: the browser must have sent Authorization, and the export stripped it.'
  : '\n-> accepted: the client fingerprint is enough, no key needed on the wire.');
