// setup.js - one-command bootstrap: .env + session.json (+ the game config) from a HAR capture.
//
// Everything the bot needs to talk to the activity is inside any HAR of it:
//
//   FMV_APP_ID      the subdomain of the activity host (https://<APP_ID>.discordsays.com)
//   FMV_KEY         the base64 `Authorization: Basic <key>:` header on any /v2/rpc request
//   FMV_DISCORD_ID  the `id`/`username` of the /v2/account/authenticate/custom call
//   session.json    the JWT on /nakama/ws?token=<jwt> (plus the refresh/discord tokens if captured)
//
// It then downloads the game config (`fetch_config.js`), so a fresh clone needs exactly:
//
//   git clone ... && cd farm-merge-valley-bot
//   node setup.js <capture.har>          # or: npm run setup -- <capture.har>
//   npm test
//   npm run apply
//
// Usage:
//   node setup.js <capture.har>         # write .env + session.json, then fetch the config
//   node setup.js <capture.har> --print # show what was found, write nothing
//   node setup.js <capture.har> --no-config   # skip the config download
//
// A re-capture is usually a WS-only HAR (one /nakama/ws entry): it carries a fresh token but none
// of the ids, so they are inherited from the existing .env instead of being required again.
//
// Secrets are never printed - only their length and a short prefix.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const PRINT_ONLY = args.includes('--print');
const NO_CONFIG = args.includes('--no-config');
const HAR = args.find((a) => !a.startsWith('--')) || process.env.FMV_HAR
  || path.join(process.env.USERPROFILE || '', 'Downloads', 'farm_merge_launch.har');

if (!fs.existsSync(HAR)) {
  console.error(`capture not found: ${HAR}`);
  console.error('usage: node setup.js <capture.har>   (DevTools -> Network -> Save all as HAR)');
  process.exit(1);
}

const mask = (v, n = 6) => (v ? `${String(v).slice(0, n)}… len ${String(v).length}` : '(not found)');
const jwtExp = (t) => {
  try {
    const c = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8'));
    return { exp: c.exp, when: new Date(c.exp * 1000).toISOString(), uid: c.uid };
  } catch {
    return null;
  }
};

console.log(`har: ${HAR}`);
const raw = fs.readFileSync(HAR, 'utf8');
console.log(`size: ${(raw.length / 1048576).toFixed(1)} MB`);
const har = JSON.parse(raw);
const entries = har.log.entries || [];
console.log(`entries: ${entries.length}\n`);

// ---- APP_ID: the host every activity request goes to ------------------------
const hosts = {};
for (const e of entries) {
  const m = String(e.request?.url || '').match(/https:\/\/(\d+)\.discordsays\.com/);
  if (m) hosts[m[1]] = (hosts[m[1]] || 0) + 1;
}
const APP_ID = Object.entries(hosts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// ---- walk the entries once ------------------------------------------------
let wsToken = null;
let serverKey = null;
let discordId = null;
let nakamaRt = null;
let discordAt = null;
let discordRt = null;
const vars = {};

for (const e of entries) {
  const req = e.request || {};
  const url = String(req.url || '');

  if (!wsToken && url.includes('/nakama/ws')) {
    const m = url.match(/[?&]token=([A-Za-z0-9._-]+)/);
    if (m) wsToken = decodeURIComponent(m[1]);
  }

  const auth = url.match(/authenticate\/custom\?[^&]*?(?:username|id)=([^&"']+)/);
  if (auth && !discordId) discordId = decodeURIComponent(auth[1]);

  for (const h of req.headers || []) {
    const name = String(h.name || '').toLowerCase();
    const value = String(h.value || '');
    if (!serverKey && name === 'authorization' && /^basic\s+/i.test(value)) {
      serverKey = Buffer.from(value.replace(/^basic\s+/i, ''), 'base64').toString('utf8').replace(/:$/, '');
    }
  }

  const body = req.postData?.text;
  if (body && body.includes('discord_app_id')) {
    try {
      const o = JSON.parse(body);
      if (o.id && !discordId) discordId = String(o.id);
      for (const [k, v] of Object.entries(o.vars || {})) if (v) vars[k] = v;
    } catch {}
  }
  if (body && url.includes('/api/auth/discord')) {
    try {
      const o = JSON.parse(body);
      if (o.refresh_token) discordRt = o.refresh_token;
    } catch {}
  }

  const text = e.response?.content?.text;
  if (text && url.includes('authenticate/custom')) {
    try {
      const o = JSON.parse(text);
      if (o.refresh_token) nakamaRt = o.refresh_token;
      if (o.token && !wsToken) wsToken = o.token;
    } catch {}
  }
  if (text && url.includes('/api/auth/discord')) {
    try {
      const o = JSON.parse(text);
      if (o.access_token) discordAt = o.access_token;
      if (o.refresh_token) discordRt = o.refresh_token;
    } catch {}
  }
}

// ---- report ---------------------------------------------------------------
const exp = jwtExp(wsToken);
console.log(`FMV_APP_ID      ${APP_ID || '(not found)'}`);
console.log(`FMV_KEY         ${mask(serverKey)}`);
console.log(`FMV_DISCORD_ID  ${discordId || '(not found)'}`);
console.log(`session_token   ${mask(wsToken)}`);
console.log(`  jwt exp       ${exp ? `${exp.when}  (${exp.exp * 1000 <= Date.now() ? 'EXPIRED' : 'valid'})  uid ${exp.uid}` : '(unparseable)'}`);
console.log(`refresh_token   ${mask(nakamaRt)}`);
const rtExp = jwtExp(nakamaRt);
if (rtExp) console.log(`  jwt exp       ${rtExp.when}  (${rtExp.exp * 1000 <= Date.now() ? 'EXPIRED' : 'valid'})`);
console.log(`discord tokens  at ${mask(discordAt)}  rt ${mask(discordRt)}`);
console.log(`discord vars    app_id ${vars.discord_app_id || '-'}  channel ${mask(vars.discord_channel_id, 8)}  instance ${mask(vars.discord_instance_id, 8)}`);

if (PRINT_ONLY) process.exit(0);

// ---- merge with an existing .env ------------------------------------------
// A re-capture is usually WS-only (one /nakama/ws entry): it carries the new token but none of the
// ids, which are unchanged. So keep whatever the existing .env already has instead of refusing.
const ENV = path.join(process.cwd(), '.env');
const SESSION = path.join(process.cwd(), 'session.json');

const known = {};
if (fs.existsSync(ENV)) {
  for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) known[m[1]] = m[2].trim();
  }
}

const KEY = serverKey || known.FMV_KEY || '';
const DID = discordId || known.FMV_DISCORD_ID || '';
const APP = APP_ID || known.FMV_APP_ID || '';

const missing = [
  ['FMV_DISCORD_ID', DID], ['FMV_APP_ID', APP], ['session_token', wsToken],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`\nrefusing to write: missing ${missing.join(', ')}`);
  if (!fs.existsSync(ENV)) console.error('(nothing to inherit from - capture an .env from a full HAR first)');
  process.exit(1);
}
if (!serverKey) {
  console.log('\nnote: no `Authorization: Basic` header in this capture, so FMV_KEY is left as it was.');
  console.log('      That is fine for normal runs (RPC authenticates with the session token); only');
  console.log('      `--refresh` needs it.');
}

if (fs.existsSync(ENV)) {
  fs.copyFileSync(ENV, `${ENV}.bak`);
  console.log(`\n(existing .env backed up to .env.bak)`);
}

const WRITTEN = new Set(['FMV_KEY', 'FMV_DISCORD_ID', 'FMV_APP_ID', 'FMV_CFG', 'FMV_HAR']);
const extra = Object.entries(known).filter(([k]) => !WRITTEN.has(k));

fs.writeFileSync(ENV, [
  '# generated by setup.js - NEVER commit this file',
  `FMV_KEY=${KEY}`,
  `FMV_DISCORD_ID=${DID}`,
  `FMV_APP_ID=${APP}`,
  `FMV_CFG=${known.FMV_CFG || './config'}`,
  `FMV_HAR=${HAR}`,
  ...extra.map(([k, v]) => `${k}=${v}`),
  '',
].join('\n'));

fs.writeFileSync(SESSION, JSON.stringify({
  origin: `https://${APP}.discordsays.com`,
  proxy: '/.proxy/nakama',
  session_token: wsToken,
  ...(nakamaRt ? { nakama_refresh_token: nakamaRt } : {}),
  ...(discordAt ? { discord_access_token: discordAt } : {}),
  ...(discordRt ? { discord_refresh_token: discordRt } : {}),
  discord_app_id: vars.discord_app_id || APP,
  discord_channel_id: vars.discord_channel_id || '',
  discord_instance_id: vars.discord_instance_id || '',
}, null, 1));

console.log(`\nwrote .env and session.json (both git-ignored)`);
if (exp && exp.exp * 1000 <= Date.now()) {
  console.log(`\nWARNING: the captured session token expired ${exp.when}.`);
  console.log('Restart the activity + re-export the HAR to drive it over HTTP, or run with --refresh');
  console.log('(only if the refresh token is still valid AND you are not playing).');
} else if (exp) {
  console.log(`session token valid until ${exp.when}`);
}

// ---- game config ----------------------------------------------------------
// The bot reads the game's own jsonpacks; they are game assets, so they are downloaded, never
// committed. This is the second half of the setup, so do it here instead of making the user read on.
if (NO_CONFIG) {
  console.log('\n(--no-config) config not downloaded - run `npm run config` before using the bot');
} else {
  console.log('\ndownloading the game config...\n');
  const r = spawnSync(process.execPath, [path.join(process.cwd(), 'fetch_config.js')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('\nconfig download failed - run `npm run config` again');
    process.exit(r.status ?? 1);
  }
}

console.log('\ndone. next:');
console.log('  npm test                 # fixture tests - no network, no writes');
console.log('  npm run dry              # read-only plan against your account');
console.log('  npm run apply            # apply one full round');

