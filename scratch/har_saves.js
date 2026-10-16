// Extract every SAVE_PLAYER_DATA_V2 from the HAR, in order, and report which models each one carries.
import fs from 'node:fs';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const saves = [];

har.log.entries.forEach((e, ei) => {
  const t = e.startedDateTime;
  const url = e.request.url || '';

  // HTTP RPC
  if (/rpc\/SAVE_PLAYER_DATA_V2/i.test(url)) {
    const body = e.request.postData?.text;
    if (body) saves.push({ seq: saves.length, src: 'http', t, ei, payload: body });
  }

  // WebSocket frames
  (e._webSocketMessages || []).forEach((m, mi) => {
    if (m.type !== 'send') return;
    let o;
    try { o = JSON.parse(m.data); } catch { return; }
    if (o?.rpc?.id === 'SAVE_PLAYER_DATA_V2' && o.rpc.payload) {
      saves.push({ seq: saves.length, src: 'ws', t, ei, mi, payload: o.rpc.payload });
    }
  });
});

console.log(`found ${saves.length} SAVE_PLAYER_DATA_V2 calls\n`);

const decoded = saves.map((s) => {
  let models = {};
  let err = null;
  try { models = decodeModels(b64ToBuf(s.payload)); }
  catch (e) { err = e.message; }
  return { ...s, models, err };
});

decoded.forEach((s, i) => {
  const keys = Object.keys(s.models);
  const when = s.src === 'ws' ? `${s.t} ws#${s.mi}` : `${s.t} http`;
  console.log(`[${String(i).padStart(2)}] ${s.src.padEnd(4)} b64=${String(s.payload.length).padStart(6)} ${err0(s)}models=${String(keys.length).padStart(3)}  ${when}`);
  if (s.err) console.log(`      ERROR: ${s.err}`);
  else if (keys.length <= 8) console.log(`      ${keys.join(', ')}`);
});
function err0(s) { return s.err ? '' : ''; }

fs.writeFileSync(process.env.FMV_OUT || 'har_saves.json', JSON.stringify(
  decoded.map((s) => ({ seq: s.seq, src: s.src, t: s.t, models: s.models })),
  null, 0
));
console.log(`\nwrote ${process.env.FMV_OUT || 'har_saves.json'}`);
