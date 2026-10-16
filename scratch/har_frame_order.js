import '../lib/env.js';
// scratch/har_frame_order.js - frame-ordered list of the interesting sends, so claim frames can
// be aligned with SAVE frames (the HAR's per-entry startedDateTime is shared, so only index order helps).
import fs from 'node:fs';

const HAR = process.env.FMV_HAR || './capture_levelup.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
const WANT = /SAVE_PLAYER_DATA_V2|CLAIM_REWARD|GET_REWARD_DATA|GET_NEW_REWARD_CLAIMS|GET_ACTIVE_TIMED_CONFIGURATIONS|CONSUME_FRIEND_FARM_ACTION|GET_VISITED_FRIENDS|CLAIM/i;

let idx = 0;
let saveNo = 0;
for (const e of har.log?.entries || []) {
  for (const m of e._webSocketMessages || []) {
    idx++;
    if (m.type !== 'send') continue;
    let o;
    try { o = JSON.parse(m.data); } catch { continue; }
    const id = o?.rpc?.id;
    if (!id || !WANT.test(id)) continue;
    let note = '';
    if (id === 'SAVE_PLAYER_DATA_V2') { saveNo++; note = `save#${saveNo - 1}`; }
    else if (o.rpc.payload) {
      try {
        const b = Buffer.from(o.rpc.payload, 'base64');
        const s = b.toString('utf8');
        note = /[\x00-\x08\x0e-\x1f]/.test(s) ? b.toString('hex') : s.replace(/\n/g, '\\n');
      } catch { note = '(?)'; }
    }
    console.log(`frame ${String(idx).padStart(4)}  cid=${String(o.cid).padStart(4)}  ${id.padEnd(28)} ${note}`);
  }
}
