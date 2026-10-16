// Does refreshing our session disturb the player's live client?
// Test: refresh to get a NEW token, then confirm BOTH old and new tokens still work.
import { loadSession, saveSession, httpRpc, httpBase } from '../lib/nakama.js';

const s = loadSession();

const check = async (label, token) => {
  const probe = { ...s, session_token: token };
  try {
    const t = await httpRpc('GET_SERVER_TIME', Buffer.alloc(0), probe);
    console.log(`  ${label.padEnd(22)} VALID   (${t})`);
    return true;
  } catch (e) {
    console.log(`  ${label.padEnd(22)} INVALID (${String(e.message).slice(0, 90)})`);
    return false;
  }
};

console.log('BEFORE refresh:');
await check('existing session', s.session_token);

const res = await fetch(httpBase(s) + '/v2/account/session/refresh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: s.nakama_refresh_token }),
});
console.log('\nrefresh HTTP', res.status);
const body = await res.text();
if (!res.ok) {
  console.log('refresh failed:', body.slice(0, 400));
  process.exit(1);
}
const j = JSON.parse(body);
console.log('  new token       :', j.token?.slice(0, 24), 'len', j.token?.length);
console.log('  new refresh     :', j.refresh_token?.slice(0, 24), 'len', j.refresh_token?.length);
console.log('  refresh rotated :', j.refresh_token !== s.nakama_refresh_token);

console.log('\nAFTER refresh:');
const oldOk = await check('OLD session (client)', s.session_token);
const newOk = await check('NEW session (bot)', j.token);
const oldRefreshOk = await (async () => {
  const r = await fetch(httpBase(s) + '/v2/account/session/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: s.nakama_refresh_token }),
  });
  console.log(`  ${'OLD refresh token'.padEnd(22)} ${r.ok ? 'VALID' : 'INVALID'} (${r.status})`);
  return r.ok;
})();

const out = { ...s, session_token: j.token, nakama_refresh_token: j.refresh_token };
saveSession(out);
console.log('\nsaved new session -> session.json');
console.log('\nVERDICT:');
console.log('  parallel-safe (old token alive):', oldOk);
console.log('  old refresh reusable           :', oldRefreshOk, '(true => no rotation lockout at all)');
console.log('  bot token usable               :', newOk);
