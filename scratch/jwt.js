import '../lib/env.js';
// scratch/jwt.js - decode the sid/exp of the bot's stored Nakama token vs the client's HAR token.
import fs from 'node:fs';

const dec = (tok) => {
  try {
    const p = tok.split('.')[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return { error: e.message }; }
};

const s = JSON.parse(fs.readFileSync('session.json', 'utf8'));
console.log('--- bot session.json ---');
for (const k of ['session_token', 'nakama_refresh_token']) {
  const j = dec(s[k] || '');
  console.log(`${k}: sid=${j.sid} uid=${j.uid} exp=${j.exp} iat=${j.iat} (${j.exp ? new Date(j.exp * 1000).toISOString() : ''})`);
}

const har = JSON.parse(fs.readFileSync((process.env.FMV_HAR || './capture_launch.har'), 'utf8'));
for (const e of har.log?.entries || []) {
  const u = e.request?.url || '';
  if (!u.includes('/nakama/ws')) continue;
  const m = /[?&]token=([^&]+)/.exec(u);
  if (!m) continue;
  const j = dec(decodeURIComponent(m[1]));
  console.log('\n--- client HAR ws token ---');
  console.log(`sid=${j.sid} uid=${j.uid} exp=${j.exp} iat=${j.iat}`);
  break;
}
