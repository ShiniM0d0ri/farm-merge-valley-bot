// SAVE_PLAYER_DATA_V2 transport test: HTTP(base64) vs HTTP(raw) vs WS(base64).
import { loadSession, httpRpc, wsBase } from '../lib/nakama.js';
import { decodeModels, b64ToBuf, encodeModelEntry } from '../lib/proto.js';

const s = loadSession();
const readAll = async () => decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

const before = await readAll();
const target = Object.values(before).find(
  (m) => m.key.startsWith('TilesStateModel_') && m.json && !m.json?.data?.state?.data?.mergeable
) || Object.values(before).find((m) => m.key.startsWith('TilesStateModel_') && m.json);
console.log('target:', target.key, JSON.stringify(target.json).slice(0, 100));
const payload = encodeModelEntry(target.key, target.json, target.md5, target.ts);
console.log('payload bytes:', payload.length);

const show = (label, status, text) => {
  console.log(`\n${label}: HTTP ${status}`);
  console.log('  ', text.slice(0, 260));
};

// A. HTTP, base64 body (what our helper does today)
{
  const r = await fetch(`${s.origin + s.proxy}/v2/rpc/SAVE_PLAYER_DATA_V2?unwrap=true`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + s.session_token, 'Content-Type': 'text/plain' },
    body: payload.toString('base64'),
  });
  show('A http+base64', r.status, await r.text());
}

// B. HTTP, raw protobuf body
{
  const r = await fetch(`${s.origin + s.proxy}/v2/rpc/SAVE_PLAYER_DATA_V2?unwrap=true`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + s.session_token, 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
  show('B http+raw', r.status, await r.text());
}

// C. WebSocket, base64 payload (the game's real path)
{
  const url = `${wsBase(s)}?lang=en&status=true&token=${encodeURIComponent(s.session_token)}`;
  const out = await new Promise((resolve) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.close(); resolve('TIMEOUT'); }, 15000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ cid: '1', rpc: { id: 'SAVE_PLAYER_DATA_V2', payload: payload.toString('base64') } })));
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.ping !== undefined) return ws.send(JSON.stringify({ pong: m.ping }));
      if (m.cid === '1') { clearTimeout(t); ws.close(); resolve(JSON.stringify(m.rpc).slice(0, 260)); }
    });
    ws.addEventListener('error', () => { clearTimeout(t); resolve('WS ERROR'); });
  });
  console.log('\nC ws+base64:', out);
}

const after = await readAll();
const same = JSON.stringify(before[target.key].json) === JSON.stringify(after[target.key].json);
console.log('\nvalue unchanged after save attempts:', same);
console.log('md5 before/after:', before[target.key].md5, '/', after[target.key].md5);
