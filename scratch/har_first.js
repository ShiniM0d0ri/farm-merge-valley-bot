import '../lib/env.js';
// scratch/har_first.js - print the first N WS frames (handshake) and any 'connect'/'session' frames.
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8'));
const n = Number(process.argv[2] || 14);
for (const e of har.log?.entries || []) {
  const msgs = e._webSocketMessages;
  if (!msgs) continue;
  msgs.slice(0, n).forEach((m, i) => {
    const d = m.data || '';
    console.log(`\n[${i}] ${m.type} @${m.time}`);
    console.log(d.length > 900 ? d.slice(0, 900) + ` …(+${d.length - 900})` : d);
  });
  break;
}
