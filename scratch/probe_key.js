// With the recovered server key: mint our own session + renew indefinitely.
import { loadSession, saveSession, httpRpc, httpBase } from '../lib/nakama.js';
import { SERVER_KEY, DISCORD_ID } from '../lib/creds.js';

const s = loadSession();
const KEY = { Authorization: 'Bearer ' + SERVER_KEY };

const post = async (path, body, headers = {}) => {
  const r = await fetch(httpBase(s) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, text: await r.text() };
};

const check = async (label, sess) => {
  try {
    const t = await httpRpc('GET_SERVER_TIME', Buffer.alloc(0), sess);
    console.log(`  ${label.padEnd(26)} VALID   (${t})`);
    return true;
  } catch (e) {
    console.log(`  ${label.padEnd(26)} INVALID (${String(e.message).slice(0, 70)})`);
    return false;
  }
};

console.log('--- 1. session/refresh with server key (renewal path) ---');
const r1 = await post('/v2/account/session/refresh', { token: s.nakama_refresh_token }, KEY);
console.log('HTTP', r1.status, r1.text.slice(0, 140));
let renewed = null;
try {
  const j = JSON.parse(r1.text);
  if (j.token) renewed = { ...s, session_token: j.token, nakama_refresh_token: j.refresh_token };
} catch {}

console.log('\n--- 2. authenticate/custom with server key (mint path) ---');
const r2 = await post(
  `/v2/account/authenticate/custom?create=true&username=${DISCORD_ID}&`,
  {
    id: DISCORD_ID,
    vars: {
      netversion: '10',
      discord_app_id: s.discord_app_id || '1187013846746005515',
      discord_channel_id: s.discord_channel_id || '',
      discord_instance_id: s.discord_instance_id || '',
      discord_access_token: s.discord_access_token,
    },
  },
  KEY
);
console.log('HTTP', r2.status, r2.text.slice(0, 140));
let minted = null;
try {
  const j = JSON.parse(r2.text);
  if (j.token) minted = { ...s, session_token: j.token, nakama_refresh_token: j.refresh_token };
} catch {}

console.log('\n--- 3. three sessions side by side ---');
await check('player client (untouched)', s);
if (renewed) await check('renewed (refresh path)', renewed);
if (minted) await check('minted (authenticate)', minted);

const chosen = renewed || minted;
if (chosen) { saveSession(chosen); console.log('\nsaved bot session -> session.json'); }
