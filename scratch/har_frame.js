import '../lib/env.js';
// scratch/har_frame.js - print WS frames whose rpc id matches an argument substring.
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8'));
const needle = (process.argv[2] || 'GET_NEW_REWARD_CLAIMS').toLowerCase();
const entries = har.log?.entries || [];
for (const e of entries) {
  const msgs = e._webSocketMessages;
  if (!msgs) continue;
  msgs.forEach((m, i) => {
    const d = m.data || '';
    if (!d.toLowerCase().includes(needle)) return;
    console.log(`\n----- frame ${i} type=${m.type} t=${m.time} -----`);
    console.log(d.length > 4000 ? d.slice(0, 4000) + ` …(+${d.length - 4000})` : d);
  });
}
