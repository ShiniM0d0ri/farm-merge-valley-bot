// Which (host, auth) combination accepts authenticate/custom?
import { loadSession } from '../lib/nakama.js';
import { SERVER_KEY, DISCORD_ID } from '../lib/creds.js';

const s = loadSession();
const path = `/v2/account/authenticate/custom?create=true&username=${DISCORD_ID}&`;
const body = JSON.stringify({
  id: DISCORD_ID,
  vars: {
    netversion: '10',
    discord_app_id: '1187013846746005515',
    discord_channel_id: s.discord_channel_id,
    discord_instance_id: s.discord_instance_id,
    discord_access_token: s.discord_access_token,
  },
});

const hosts = ['/.proxy/nakama', '/.proxy/publicNakama'];
const auths = [
  ['none', {}],
  ['Bearer(serverkey)', { Authorization: 'Bearer ' + SERVER_KEY }],
  ['Bearer(session)', { Authorization: 'Bearer ' + s.session_token }],
  ['Basic(serverkey:', { Authorization: 'Basic ' + Buffer.from(SERVER_KEY + ':').toString('base64') }],
];

for (const h of hosts) {
  for (const [label, extra] of auths) {
    let out;
    try {
      const r = await fetch(s.origin + h + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: s.origin, ...extra },
        body,
      });
      out = `${r.status} ${(await r.text()).slice(0, 110)}`;
    } catch (e) {
      out = 'ERR ' + e.message;
    }
    console.log(`${h.padEnd(24)} ${label.padEnd(18)} ${out}`);
  }
}
