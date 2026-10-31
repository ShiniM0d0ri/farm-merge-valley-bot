// scratch/cdp_capture.js - load a URL in a throwaway Chrome over CDP and report what it calls.
//
// Built for one question: what does a Farm Merge Valley web build send to its backend, and does it
// carry a Nakama `Authorization: Basic <server key>` header? Chrome is launched with its own
// temporary profile (no cookies, no logins), so nothing of the user's is touched.
//
//   node scratch/cdp_capture.js <url> [seconds]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.FMV_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = process.argv[2];
const SECONDS = Number(process.argv[3] || 35);
if (!TARGET) {
  console.error('usage: node scratch/cdp_capture.js <url> [seconds]');
  process.exit(1);
}

const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fmv-cdp-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--mute-audio', 'about:blank',
], { stdio: 'ignore' });

let targets = null;
for (let i = 0; i < 80 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch {
    await sleep(250);
  }
}
const page = (targets || []).find((t) => t.type === 'page');
if (!page) {
  chrome.kill();
  throw new Error('CDP endpoint did not come up');
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

/** requestId -> { url, method, type, headers } */
const reqs = new Map();
const hosts = new Map();
const websockets = [];
const bodies = [];
let consoleErrors = 0;

ws.onmessage = async (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }

  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    const host = (() => { try { return new URL(r.url).host; } catch { return '?'; } })();
    hosts.set(host, (hosts.get(host) || 0) + 1);
    reqs.set(msg.params.requestId, {
      url: r.url, method: r.method, type: msg.params.type, headers: { ...(r.headers || {}) },
    });
  }

  if (msg.method === 'Network.requestWillBeSentExtraInfo') {
    const cur = reqs.get(msg.params.requestId) || { headers: {} };
    cur.headers = { ...(cur.headers || {}), ...(msg.params.headers || {}) };
    reqs.set(msg.params.requestId, cur);
  }

  if (msg.method === 'Network.webSocketCreated') {
    websockets.push(msg.params.url);
  }

  if (msg.method === 'Network.responseReceived') {
    const cur = reqs.get(msg.params.response.url ? undefined : undefined);
    const t = msg.params.type;
    const mime = msg.params.response.mimeType || '';
    // pull JS + XHR/fetch/doc bodies so the bundle and any JSON config can be searched
    if (['Script', 'XHR', 'Fetch', 'Document'].includes(t) || /javascript|json|html/.test(mime)) {
      send('Network.getResponseBody', { requestId: msg.params.requestId });
    }
  }

  if (msg.method === 'Network.getResponseBody') {
    // responses are matched by the requestId in the *command* reply, handled below
  }

  if (msg.id && msg.result && typeof msg.result.body === 'string') {
    bodies.push({ requestId: msg.id, body: msg.result.body });
  }

  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors++;
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors++;
};

send('Network.enable');
send('Page.enable');
send('Runtime.enable');
send('Page.navigate', { url: TARGET });

const deadline = Date.now() + SECONDS * 1000;
while (Date.now() < deadline) await sleep(500);

ws.close();
chrome.kill();
await sleep(500);
fs.rmSync(profile, { recursive: true, force: true });

// ---- report ---------------------------------------------------------------
const entries = [...reqs.values()];
const hdr = (h, name) => {
  const k = Object.keys(h || {}).find((x) => x.toLowerCase() === name);
  return k ? String(h[k]) : null;
};
const mask = (v, n = 10) => (v ? `${v.slice(0, n)}… (${v.length})` : null);

console.log(`url: ${TARGET}`);
console.log(`requests: ${entries.length}   console errors: ${consoleErrors}\n`);

console.log('hosts:');
for (const [h, n] of [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${h}`);

console.log('\nwebsocket urls:');
if (!websockets.length) console.log('  (none)');
for (const w of websockets.slice(0, 8)) console.log(`  ${w.slice(0, 190)}`);

const auths = entries.filter((e) => hdr(e.headers, 'authorization') || hdr(e.headers, 'cookie'));
console.log(`\nrequests carrying authorization/cookie: ${auths.length}`);
for (const e of auths.slice(0, 20)) {
  console.log(`  ${e.method} ${e.url.slice(0, 120)}`);
  console.log(`     authorization: ${mask(hdr(e.headers, 'authorization'), 24)}`);
  console.log(`     cookie:        ${mask(hdr(e.headers, 'cookie'), 16)}`);
}

const api = entries.filter((e) => /nakama|\/v2\/|rpc|\.proxy/i.test(e.url));
console.log(`\nbackend-looking requests: ${api.length}`);
const seen = new Set();
for (const e of api) {
  const k = e.method + ' ' + e.url.replace(/[?].*/, '');
  if (seen.has(k)) continue;
  seen.add(k);
  const a = hdr(e.headers, 'authorization');
  console.log(`  ${e.method} ${e.url.slice(0, 150)}${a ? `\n     auth: ${mask(a, 24)}` : ''}`);
  if (seen.size > 25) break;
}

// ---- what the JS says about nakama ---------------------------------------
const KEY_HINTS = [/serverkey/gi, /server_key/gi, /defaultkey/gi, /httpKey/gi, /"basic\s/gi, /nakama.{0,60}?key/gi];
const hits = [];
for (const b of bodies) {
  if (!b.body || b.body.length < 40) continue;
  for (const re of KEY_HINTS) {
    re.lastIndex = 0;
    const m = re.exec(b.body);
    if (!m) continue;
    hits.push(b.body.slice(Math.max(0, m.index - 100), m.index + 140).replace(/\s+/g, ' '));
    break;
  }
  if (hits.length > 12) break;
}
console.log(`\nbundles/bodies fetched: ${bodies.length}`);
if (hits.length) {
  console.log('key-ish strings in the payloads:');
  for (const h of hits) console.log(`  …${h}…`);
} else {
  console.log('no server-key-looking strings in the fetched payloads');
}
