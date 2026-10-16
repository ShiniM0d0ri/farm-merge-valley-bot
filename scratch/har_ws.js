import '../lib/env.js';
// scratch/har_ws.js - list the RPC ids used over the HAR WebSocket frames.
import fs from 'node:fs';
const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
console.log(`har: ${HAR}`);
const entries = har.log?.entries || [];
const sent = new Map();
const recv = new Map();
let wsEntries = 0, frames = 0;
for (const e of entries) {
  const msgs = e._webSocketMessages;
  if (!msgs) continue;
  wsEntries++;
  for (const m of msgs) {
    frames++;
    const op = m.type; // send / receive
    const data = m.data || '';
    // Nakama ws frames are JSON like {"cid":"1","rpc":{"id":"get_all_player_data_v2",...}}
    let id = null;
    const m1 = /"rpc"\s*:\s*\{[^}]*?"id"\s*:\s*"([^"]+)"/.exec(data);
    if (m1) id = m1[1];
    else {
      const m2 = /"id"\s*:\s*"([a-z0-9_]+)"/i.exec(data);
      if (m2 && /player_data|rpc|claim|reward|level|crate/i.test(data)) id = m2[1];
    }
    if (!id) continue;
    const dst = op === 'send' ? sent : recv;
    dst.set(id, (dst.get(id) || 0) + 1);
  }
}
console.log(`ws entries=${wsEntries} frames=${frames}`);
console.log('\nSENT rpc ids:');
for (const [k, n] of [...sent.entries()].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log('\nRECV rpc ids:');
for (const [k, n] of [...recv.entries()].sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
