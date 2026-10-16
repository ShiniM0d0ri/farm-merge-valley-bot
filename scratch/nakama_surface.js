import '../lib/env.js';
// scratch/nakama_surface.js - every HTTP URL + WS RPC id in a capture, with shapes.
//
// The launch capture is reported to contain no HTTP RPC traffic at all, which would mean the initial
// full-state read (GET_ALL_PLAYER_DATA) never made it into the file. That matters: the tier-4
// producers materialised 3.7s after load, so a live cooldown timer for them DID exist - and the only
// place it could have been recorded is the session's first read. Find out whether that read is here.
import fs from 'node:fs';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
console.log(`${HAR}\n${har.log.entries.length} entries\n`);

console.log('=== HTTP entries on a nakama path ===');
let n = 0;
for (const e of har.log.entries) {
  const url = e.request?.url || '';
  if (!/nakama/i.test(url)) continue;
  n++;
  const body = e.request?.postData?.text || '';
  const resp = e.response?.content?.text || '';
  console.log(`${e.request.method} ${url}`);
  console.log(`   req body ${body.length} chars: ${JSON.stringify(body.slice(0, 80))}`);
  console.log(`   resp ${e.response.status} ${resp.length} chars: ${JSON.stringify(resp.slice(0, 80))}`);
}
console.log(`(${n})`);

console.log('\n=== WS rpc ids ===');
const ids = new Map();
for (const e of har.log.entries) {
  for (const m of e._webSocketMessages || []) {
    let o;
    try { o = JSON.parse(m.data); } catch { continue; }
    const id = o?.rpc?.id ?? o?.cid ?? '(no rpc/cid)';
    const key = `${m.type} ${id}`;
    const cur = ids.get(key) || { n: 0, lens: [], sample: '' };
    cur.n++;
    if (cur.lens.length < 6) cur.lens.push((o.rpc?.payload || m.data || '').length);
    if (!cur.sample) cur.sample = JSON.stringify(m.data.slice(0, 100));
    ids.set(key, cur);
  }
}
for (const [k, v] of [...ids.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(v.n).padStart(5)}x ${k}  lens=${v.lens.join(',')}`);
  console.log(`         ${v.sample}`);
}
