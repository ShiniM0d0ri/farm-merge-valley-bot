import '../lib/env.js';
// scratch/har_rpc.js - dump one RPC id from a HAR, pairing sends with their responses by cid,
// and decoding the base64 payloads when they look like text/JSON.
//
//   FMV_HAR=<path> node har_rpc.js CLAIM_REWARD
//
// For SAVE_PLAYER_DATA_V2 the payload is huge, so it is summarised instead of printed.
import fs from 'node:fs';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const needle = (process.argv[2] || 'CLAIM_REWARD').toUpperCase();
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const rd = (b64) => {
  if (!b64) return '(empty)';
  try {
    const buf = Buffer.from(b64, 'base64');
    const s = buf.toString('utf8');
    // printable?
    if (!/[\x00-\x08\x0e-\x1f]/.test(s)) return s;
    return `(binary ${buf.length}B) ${buf.toString('hex').slice(0, 120)}`;
  } catch { return '(undecodable)'; }
};

const sends = new Map(); // cid -> {t, payload}
const rows = [];

for (const e of har.log?.entries || []) {
  for (const m of e._webSocketMessages || []) {
    let o;
    try { o = JSON.parse(m.data); } catch { continue; }
    const rpc = o?.rpc;
    if (!rpc?.id) continue;
    if (String(rpc.id).toUpperCase() !== needle) continue;
    const cid = String(o.cid ?? '');
    if (m.type === 'send') {
      let extra = '';
      if (String(rpc.id).toUpperCase() === 'SAVE_PLAYER_DATA_V2') {
        extra = `payload ${rpc.payload ? rpc.payload.length : 0} b64 chars`;
      } else {
        extra = rd(rpc.payload);
      }
      sends.set(cid, extra);
      rows.push({ cid, dir: 'send', body: extra, t: m.time });
    } else {
      rows.push({ cid, dir: 'recv', body: rd(rpc.payload), t: m.time });
    }
  }
}

console.log(`${needle}: ${rows.length} frame(s) in ${HAR}\n`);
for (const r of rows) {
  const tag = r.dir === 'send' ? '-->' : '<--';
  const body = r.body.length > 3000 ? r.body.slice(0, 3000) + ` …(+${r.body.length - 3000})` : r.body;
  console.log(`${tag} cid=${r.cid} t=${r.t}\n    ${body}\n`);
}
