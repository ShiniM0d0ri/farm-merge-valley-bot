// Nakama transport: HTTP RPC + WebSocket RPC, plus session persistence.
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_KEY, requireCreds } from './creds.js';

export const SESSION_PATH =
  process.env.FMV_SESSION || path.join(process.cwd(), 'session.json');

export function loadSession() {
  return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
}

export function saveSession(s) {
  fs.writeFileSync(SESSION_PATH, JSON.stringify(s, null, 1));
}

export const httpBase = (s) => s.origin + s.proxy;
export const wsBase = (s) => s.origin.replace(/^http/, 'ws') + s.proxy + '/ws';

// ---------------------------------------------------------------------------
// Session lifetime
//
// The Nakama session token is a JWT that expires (the one captured in
// session.json lasts ~24 h). Nothing in the game refreshes it for the bot, so an
// unattended run would otherwise start 401-ing forever and look like it was
// "working" while writing nothing. `httpRpc` therefore renews once on a 401 and
// retries the call. Renewal is plain HTTP (`/v2/account/session/refresh`, server
// key as HTTP Basic) and does NOT open a socket, so it is safe under
// `single_socket` — see MECHANICS §8.
// ---------------------------------------------------------------------------

/** Decode the JWT `exp` and say whether it is already in the past. */
export function tokenExpired(session) {
  try {
    const part = String(session.session_token).split('.')[1];
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return claims.exp * 1000 <= Date.now();
  } catch {
    return false; // unparseable -> let the server decide
  }
}

let refreshInFlight = null;

/** Auto-renewal is OFF unless explicitly enabled (see `refreshAllowed`). */
export function refreshAllowed() {
  return process.env.FMV_ALLOW_REFRESH === '1';
}

const EXPIRED_HINT =
  'The stored Nakama session is no longer valid (expired, or superseded by your own client ' +
  're-login). Restart the Farm Merge Valley activity so the client re-authenticates, then ' +
  're-capture a token (README "Recon tooling"). To let the bot renew by itself instead, run ' +
  'with --refresh - but renewal supersedes the live session and can show the game the ' +
  '"Disconnected - Connection lost" screen (MECHANICS section 8).';

async function maybeRefresh(s) {
  if (!refreshAllowed()) throw new Error(EXPIRED_HINT);
  return refreshSession(s);
}

/** Renew the session token in place (and on disk). Concurrent callers share one request. */
export function refreshSession(session) {
  if (refreshInFlight) return refreshInFlight;
  const s = session || loadSession();
  requireCreds();
  refreshInFlight = (async () => {
    const res = await fetch(httpBase(s) + '/v2/account/session/refresh', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(SERVER_KEY + ':').toString('base64'),
        'Content-Type': 'application/json',
        Origin: s.origin,
      },
      body: JSON.stringify({ token: s.nakama_refresh_token }),
    });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch { j = null; }
    if (!res.ok || !j?.token) {
      throw new Error(`session refresh -> HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    s.session_token = j.token;
    if (j.refresh_token) s.nakama_refresh_token = j.refresh_token;
    saveSession(s);
    console.log(`session token renewed (valid to ${expiry(s)})`);
    return s;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** Human-readable token expiry, e.g. "2026-10-17 12:39 UTC". */
export function expiry(session) {
  try {
    const part = String(session.session_token).split('.')[1];
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return new Date(claims.exp * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  } catch {
    return '?';
  }
}

export async function httpRpc(rid, payload = Buffer.alloc(0), session) {
  const s = session || loadSession();
  const send = async () => {
    const body = payload && payload.length ? payload.toString('base64') : '';
    const res = await fetch(`${httpBase(s)}/v2/rpc/${rid}?unwrap=true`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + s.session_token,
        'Content-Type': 'text/plain',
      },
      body,
    });
    return { res, text: await res.text() };
  };

  if (tokenExpired(s)) await maybeRefresh(s);
  let { res, text } = await send();
  if (res.status === 401) {
    await maybeRefresh(s);
    ({ res, text } = await send());
  }
  if (!res.ok) {
    throw new Error(`${rid} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return text;
}

export async function httpRpcJson(urlPath, bodyObj, session) {
  const s = session || loadSession();
  const send = async () =>
    fetch(httpBase(s) + urlPath, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + s.session_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
    });

  if (tokenExpired(s)) await maybeRefresh(s);
  let res = await send();
  if (res.status === 401) {
    await maybeRefresh(s);
    res = await send();
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${urlPath} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

/** Send several RPCs over one WebSocket connection, reply to pings, collect responses. */
export function wsRpc(calls, { session, timeout = 20000, log = false } = {}) {
  const s = session || loadSession();
  const url = `${wsBase(s)}?lang=en&status=true&token=${encodeURIComponent(s.session_token)}`;
  return new Promise((resolve, reject) => {
    const pending = new Map();
    const results = {};
    let cid = 0;
    let done = false;
    const ws = new WebSocket(url);
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      err ? reject(err) : resolve(results);
    };
    const timer = setTimeout(() => finish(new Error('ws timeout')), timeout);

    ws.addEventListener('open', () => {
      for (const c of calls) {
        const id = String(++cid);
        pending.set(id, c.id);
        ws.send(JSON.stringify({ cid: id, rpc: { id: c.id, payload: c.payload || '' } }));
      }
    });

    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.ping !== undefined) { ws.send(JSON.stringify({ pong: m.ping })); return; }
      if (m.cid && pending.has(String(m.cid))) {
        const rid = pending.get(String(m.cid));
        results[rid] = m.rpc;
        pending.delete(String(m.cid));
        if (log) console.error('[ws] recv', rid);
        if (pending.size === 0) finish();
      }
    });

    ws.addEventListener('error', () => finish(new Error('ws error')));
    ws.addEventListener('close', () => { if (pending.size) finish(new Error('ws closed early')); });
  });
}
