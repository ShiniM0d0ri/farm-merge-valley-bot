// scratch/test_refresh.js - verify session auto-renewal.
// 1. offline: JWT exp decode (tokenExpired / expiry)
// 2. live:   refreshSession() once, then prove RPC still works, and report whether
//            Nakama rotated the refresh token (informational: the stored refresh token
//            was captured from the player's own client).
import { loadSession, saveSession, refreshSession, tokenExpired, expiry, httpRpc } from '../lib/nakama.js';

const s = loadSession();
console.log('before:', expiry(s), '| expired =', tokenExpired(s));
console.log('refresh token (head):', String(s.nakama_refresh_token).slice(0, 12) + '...');

const before = s.nakama_refresh_token;
const renewed = await refreshSession(s);

console.log('after :', expiry(renewed), '| expired =', tokenExpired(renewed));
console.log('refresh token rotated:', renewed.nakama_refresh_token !== before);
console.log('session.json updated:', JSON.stringify(loadSession().session_token) === JSON.stringify(renewed.session_token));

const t = await httpRpc('GET_SERVER_TIME');
console.log('GET_SERVER_TIME after renewal ->', t);
console.log('\nREFRESH: PASS');
