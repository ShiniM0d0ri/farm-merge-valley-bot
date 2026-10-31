// scratch/probe_origin_inject.js - does the activity context (Origin/Referer) make the proxy inject
// the server key? Historical note (scratch/probe_hdr.js): the browser's authenticate/custom carried
// no Authorization header at all, yet worked.
//
// Safe by construction: create=false with an id that does not exist. Outcomes:
//   404 -> the proxy authenticated us (key injected), no key needed
//   401 "Server key required" -> the key really is required on the wire
import fs from 'node:fs';
import { loadSession, httpBase } from '../lib/nakama.js';
import { APP_ID } from '../lib/creds.js';

const s = loadSession();

// the browser's own Referer for that call, straight out of the capture
let referer = null;
const HAR = process.env.FMV_HAR || `${process.env.USERPROFILE}\\Downloads\\farm_merge_launch.har`;
try {
  const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
  for (const e of har.log?.entries || []) {
    if (!/authenticate\/custom/.test(e.request?.url || '')) continue;
    referer = (e.request.headers || []).find((h) => /^referer$/i.test(h.name))?.value || null;
    break;
  }
} catch (e) {
  console.log(`(could not read ${HAR}: ${e.message})`);
}

const ORIGIN = s.origin || `https://${APP_ID}.discordsays.com`;
const path = '/v2/account/authenticate/custom?create=false&username=probe-does-not-exist';
const body = JSON.stringify({ id: 'probe-does-not-exist-0000', vars: {} });

console.log(`origin : ${ORIGIN}`);
console.log(`referer: ${referer ? referer.slice(0, 110) : '(none in capture)'}\n`);

const call = async (label, headers) => {
  const r = await fetch(httpBase(s) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const t = await r.text();
  console.log(`  ${label.padEnd(28)} HTTP ${String(r.status).padEnd(4)} ${t.slice(0, 100)}`);
  return { status: r.status, text: t };
};

await call('nothing', {});
await call('origin only', { Origin: ORIGIN });
const r = await call('origin + referer', { Origin: ORIGIN, ...(referer ? { Referer: referer } : {}) });
await call('origin + referer + sec-fetch', {
  Origin: ORIGIN,
  ...(referer ? { Referer: referer } : {}),
  Accept: 'application/json',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
});

console.log('');
if (r.status !== 401) {
  console.log(`VERDICT: the activity context authenticates us (HTTP ${r.status}), so the proxy injects`);
  console.log('         the server key and FMV_KEY is not needed when Origin/Referer are sent.');
} else {
  console.log('VERDICT: still 401 - the proxy does not inject; the key has to come from a capture.');
}
