// scratch/probe_refresh_auth.js - can session/refresh be authenticated WITHOUT the server key?
//
// The key exists only to authorise the refresh call. If the endpoint also accepts the session token
// as Bearer, FMV_KEY becomes unnecessary - we already hold a token. The body carries a deliberately
// invalid refresh token, so nothing can rotate and no session is disturbed.
import { loadSession, httpBase } from '../lib/nakama.js';

const s = loadSession();
const url = `${httpBase(s)}/v2/account/session/refresh`;
const BODY = JSON.stringify({ token: 'invalid-refresh-token-do-not-use' });

const call = async (label, headers) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: s.origin, ...headers },
    body: BODY,
  });
  const t = await r.text();
  console.log(`  ${label.padEnd(30)} HTTP ${String(r.status).padEnd(4)} ${t.slice(0, 120)}`);
  return { status: r.status, text: t };
};

console.log(`endpoint: ${url}`);
console.log('body: { token: "invalid-refresh-token-do-not-use" }  (cannot rotate anything)\n');

await call('no auth', {});
await call('bearer (session token)', { Authorization: 'Bearer ' + s.session_token });
await call('basic bogus-key', { Authorization: 'Basic ' + Buffer.from('not-the-key:').toString('base64') });
await call('bearer + basic bogus', {
  Authorization: 'Bearer ' + s.session_token,
  'X-Forwarded-Authorization': 'Basic ' + Buffer.from('not-the-key:').toString('base64'),
});

console.log('');
console.log('Reading: "Server key required"/"HTTP key invalid" means the key is mandatory.');
console.log('Any other error (about the token) means the gateway authenticated us by another scheme.');
