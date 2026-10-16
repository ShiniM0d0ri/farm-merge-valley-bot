// Can we mint our OWN session (independent of the player's client) AND renew it?
// Route A: /api/auth/discord {refresh_token}  -> fresh Discord token (7d)
// Route B: /v2/account/authenticate/custom    -> fresh Nakama session (no auth header needed)
import { loadSession, saveSession, httpRpc, httpBase } from '../lib/nakama.js';
import { DISCORD_ID, APP_ID } from '../lib/creds.js';

const s = loadSession();
const discordId = DISCORD_ID;

const post = async (path, body) => {
  const r = await fetch(httpBase(s) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
};

console.log('--- A. refresh the Discord access token via the game proxy ---');
const a = await post('/api/auth/discord', { refresh_token: s.discord_refresh_token });
console.log('HTTP', a.status, a.text.slice(0, 320));

let discordAt = s.discord_access_token;
let discordRt = s.discord_refresh_token;
try {
  const j = JSON.parse(a.text);
  if (j.access_token) {
    discordAt = j.access_token;
    discordRt = j.refresh_token || discordRt;
    console.log('  -> got new discord access_token, expires_in', j.expires_in);
    console.log('  -> refresh_token rotated:', j.refresh_token && j.refresh_token !== s.discord_refresh_token);
  }
} catch {}

console.log('\n--- B. mint a fresh Nakama session (no auth header, like the game) ---');
const id = encodeURIComponent(discordId);
const b = await post(
  `/v2/account/authenticate/custom?create=true&username=${id}&`,
  {
    id: discordId,
    vars: {
      netversion: '10',
      discord_app_id: APP_ID,
      discord_channel_id: s.discord_channel_id || '',
      discord_instance_id: s.discord_instance_id || '',
      discord_access_token: discordAt,
    },
  }
);
console.log('HTTP', b.status, b.text.slice(0, 160));

let newSession = null;
try {
  const j = JSON.parse(b.text);
  if (j.token) {
    newSession = { ...s, session_token: j.token, nakama_refresh_token: j.refresh_token };
    console.log('  -> new nakama token len', j.token.length, 'refresh len', j.refresh_token?.length);
  }
} catch {}

console.log('\n--- C. do BOTH sessions still work at the same time? ---');
const check = async (label, sess) => {
  try {
    const t = await httpRpc('GET_SERVER_TIME', Buffer.alloc(0), sess);
    console.log(`  ${label.padEnd(26)} VALID   (${t})`);
    return true;
  } catch (e) {
    console.log(`  ${label.padEnd(26)} INVALID (${String(e.message).slice(0, 80)})`);
    return false;
  }
};
const oldOk = await check('player client session', s);
const newOk = newSession ? await check('our own new session', newSession) : false;

if (newSession) {
  const merged = {
    ...s,
    session_token: newSession.session_token,
    nakama_refresh_token: newSession.nakama_refresh_token,
    discord_access_token: discordAt,
    discord_refresh_token: discordRt,
  };
  saveSession(merged);
  console.log('\nsaved our own independent session -> session.json');
}
console.log('\nplayer session untouched:', oldOk, '| our session works:', newOk);
