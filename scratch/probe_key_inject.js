// scratch/probe_key_inject.js - does the Discord proxy inject the Nakama server key?
//
// No client-side capture has ever shown an `Authorization` header on the activity's Nakama calls,
// and the game bundle only carries the library default "defaultkey". If the proxy supplies the
// server key, then whatever FMV_KEY holds is irrelevant for `session/refresh` - which is the only
// thing that needs it. This decides that with one harmless read: GET_SERVER_TIME.
import { loadSession, httpBase } from '../lib/nakama.js';
import { APP_ID } from '../lib/creds.js';

const s = loadSession();
const url = `${httpBase(s)}/v2/rpc/GET_SERVER_TIME?unwrap=true`;

const call = async (label, headers) => {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: s.origin || `https://${APP_ID}.discordsays.com`, ...headers },
      body: '',
    });
    const t = await r.text();
    console.log(`${label.padEnd(30)} HTTP ${String(r.status).padEnd(4)} ${t.slice(0, 90)}`);
    return r.status;
  } catch (e) {
    console.log(`${label.padEnd(30)} ERROR ${e.message}`);
    return 0;
  }
};

console.log(`endpoint: ${url}\n`);

const bearer = await call('bearer (session token)', { Authorization: 'Bearer ' + s.session_token });
const bogus = await call('basic bogus-key', { Authorization: 'Basic ' + Buffer.from('totally-bogus-key:').toString('base64') });
const empty = await call('basic empty-key', { Authorization: 'Basic ' + Buffer.from(':').toString('base64') });
const none = await call('no auth at all', {});

console.log('');
console.log(`server key known locally: ${process.env.FMV_KEY ? 'yes (' + process.env.FMV_KEY.length + ' chars)' : 'no'}`);
if (bogus === 200 || empty === 200) {
  console.log('VERDICT: the proxy injects the server key - any FMV_KEY works, so it is not needed.');
} else if (none === 200) {
  console.log('VERDICT: this RPC needs no auth at all - inconclusive for the key.');
} else {
  console.log(`VERDICT: the key is checked (bogus -> ${bogus}, bearer -> ${bearer}). It must be the real one.`);
}
