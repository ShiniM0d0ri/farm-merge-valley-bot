// scratch/probe_socket_slot.js - who holds the single socket for this account?
//
// Opens ONE socket, does a single GET_SERVER_TIME, then idles ~15 s listening.
// If Nakama notifies us with subject "single_socket", then ANOTHER socket (a zombie,
// or the game) is holding the slot and booted us. If we idle cleanly, the server is
// happy for us to be the only socket - i.e. the slot is free and the player's client
// failure is client-side.
//
// NOTE: this IS a real socket. Only run it while the player is disconnected.
import { loadSession, wsBase } from '../lib/nakama.js';

const s = loadSession();
const url = `${wsBase(s)}?lang=en&status=true&token=${encodeURIComponent(s.session_token)}`;
const HOLD_MS = Number(process.argv[2] || 15) * 1000;

// JWT claims (is there a session id?)
try {
  const claims = JSON.parse(Buffer.from(String(s.session_token).split('.')[1], 'base64url').toString('utf8'));
  console.log('JWT claims:', JSON.stringify(claims));
} catch (e) {
  console.log('JWT claims: unreadable', e.message);
}

const started = Date.now();
const ws = new WebSocket(url);
let booted = false;

ws.addEventListener('open', () => {
  console.log('[open] socket connected as uid', s.uid);
  ws.send(JSON.stringify({ cid: '1', rpc: { id: 'GET_SERVER_TIME', payload: '' } }));
});

ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.ping !== undefined) { ws.send(JSON.stringify({ pong: m.ping })); return; }
  console.log('[recv]', JSON.stringify(m).slice(0, 300));
  if (m.notification?.subject === 'single_socket') {
    booted = true;
    console.log(`    ^^^ BOOTED at t=${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
});

ws.addEventListener('error', () => console.log('[error] socket error'));
ws.addEventListener('close', (e) => console.log('[close]', e.code, e.reason || ''));

setTimeout(() => {
  console.log(`\nheld the socket for ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(booted
    ? 'VERDICT: BOOTED by another socket -> something else is logged in as this user'
    : 'VERDICT: slot was free, no other socket present -> server side is fine');
  try { ws.close(); } catch {}
  process.exit(0);
}, HOLD_MS);
