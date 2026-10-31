// scratch/probe_auth_key_requirement.js - is the server key required to authenticate?
//
// `create=false` with an id that does not exist cannot create anything: it can only answer 401
// (key rejected) or 404 (no such user). So this distinguishes "the proxy injects the key" from
// "the client must send it", without minting a session or touching the real account.
import { loadSession, httpBase } from '../lib/nakama.js';

const s = loadSession();
const url = `${httpBase(s)}/v2/account/authenticate/custom?create=false&username=probe-does-not-exist`;

const call = async (label, headers) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ id: 'probe-does-not-exist-0000', vars: {} }),
  });
  const t = await r.text();
  console.log(`  ${label.padEnd(22)} HTTP ${String(r.status).padEnd(4)} ${t.slice(0, 110)}`);
  return r.status;
};

console.log(`endpoint: ${url}\n`);
const none = await call('no auth', {});
const bogus = await call('basic bogus-key', { Authorization: 'Basic ' + Buffer.from('definitely-not-it:').toString('base64') });
console.log('');
if (bogus === 401) console.log('VERDICT: authenticate/custom REQUIRES the real key -> a full HAR would show it.');
else if (none === bogus) console.log('VERDICT: the key is irrelevant here (same answer with and without) -> the proxy supplies it.');
else console.log(`VERDICT: inconclusive (none=${none}, bogus=${bogus})`);
