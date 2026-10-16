import '../lib/env.js';
// scratch/har_scan.js - check whether the HAR mentions session/socket/presence controls.
import fs from 'node:fs';
const t = fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8');
console.log('har size', t.length);
for (const w of ['single_session', 'single_socket', 'presence', 'session_id', 'instance_id', 'proxy-ticket']) {
  console.log(`${w.padEnd(16)} ${t.includes(w)}`);
}
