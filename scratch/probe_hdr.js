// Why does the proxy accept the browser's unauthenticated authenticate/custom but not ours?
// Hypothesis: Discord's /.proxy injects upstream credentials only for requests carrying
// a valid activity context (Origin/Referer).
import fs from 'node:fs';
import { loadSession, httpBase } from '../lib/nakama.js';
import { DISCORD_ID, APP_ID } from '../lib/creds.js';

const s = loadSession();

// pull the exact browser Referer out of the HAR
const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));
let referer = null;
for (const e of har.log.entries) {
  if (e.request.url.includes('authenticate/custom')) {
    referer = (e.request.headers.find((h) => h.name.toLowerCase() === 'referer') || {}).value;
    break;
  }
}
console.log('referer:', referer);

const ORIGIN = s.origin || `https://${APP_ID}.discordsays.com`;
const discordId = DISCORD_ID;
const body = JSON.stringify({
  id: discordId,
  vars: {
    netversion: '10',
    discord_app_id: APP_ID,
    discord_channel_id: s.discord_channel_id || '',
    discord_instance_id: s.discord_instance_id || '',
    discord_access_token: s.discord_access_token,
  },
});
const path = `/.proxy/nakama/v2/account/authenticate/custom?create=true&username=${discordId}&`;

const combos = [
  { name: 'plain (control)', headers: {} },
  { name: 'origin only', headers: { Origin: ORIGIN } },
  { name: 'origin + referer', headers: { Origin: ORIGIN, Referer: referer } },
  {
    name: 'origin+referer+sec-fetch',
    headers: {
      Origin: ORIGIN,
      Referer: referer,
      Accept: 'application/json',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9262 Chrome/148.0.7778.280 Electron/42.11.11 Safari/537.36',
    },
  },
];

for (const c of combos) {
  const r = await fetch(s.origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...c.headers },
    body,
  });
  const t = await r.text();
  console.log(`\n${c.name.padEnd(24)} HTTP ${r.status}  ${t.slice(0, 150)}`);
}
