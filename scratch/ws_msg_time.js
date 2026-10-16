import '../lib/env.js';
import fs from 'node:fs';
const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
for (const e of har.log.entries) {
  const msgs = e._webSocketMessages;
  if (!msgs || !msgs.length) continue;
  console.log('entry startedDateTime =', e.startedDateTime, ' msgs =', msgs.length);
  for (const m of msgs.slice(0, 3)) {
    console.log('  keys:', Object.keys(m).join(','), '| time =', m.time, m.time ? new Date(m.time).toISOString() : '');
  }
  const withTime = msgs.filter((m) => m.time).length;
  console.log('  with time:', withTime, '/', msgs.length);
  break;
}
