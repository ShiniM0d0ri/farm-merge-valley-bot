import '../lib/env.js';
// scratch/har_resp.js - print response bodies of entries whose URL contains a substring.
import fs from 'node:fs';
const har = JSON.parse(fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8'));
const needle = (process.argv[2] || 'nakama_config').toLowerCase();
for (const e of har.log?.entries || []) {
  const u = e.request?.url || '';
  if (!u.toLowerCase().includes(needle)) continue;
  const rc = e.response?.content || {};
  let body = rc.text || '';
  if (rc.encoding === 'base64') body = Buffer.from(body, 'base64').toString('utf8');
  console.log(`\n### ${e.request.method} ${u}  (${body.length} chars)`);
  console.log(body.length > 6000 ? body.slice(0, 6000) + ` …(+${body.length - 6000})` : body);
}
