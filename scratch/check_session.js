// scratch/check_session.js - is the account reachable over HTTP right now?
import { loadSession, httpRpc, tokenExpired, expiry } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const s = loadSession();
console.log('token expiry:', expiry(s), '| expired =', tokenExpired(s));

try {
  const t = await httpRpc('GET_SERVER_TIME');
  console.log('GET_SERVER_TIME ->', t, '(server reachable)');
} catch (e) {
  console.log('GET_SERVER_TIME -> FAILED:', e.message);
  process.exit(1);
}

try {
  const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
  const i = models.InventoryModel?.json?.data;
  console.log('GET_ALL_PLAYER_DATA_V2 ->', Object.keys(models).length, 'models');
  if (i) console.log('inventory: level', i.level, 'exp', i.exp, 'coins', i.coins, 'energy', i.energy, 'crates', i.crates);
} catch (e) {
  console.log('GET_ALL_PLAYER_DATA_V2 -> FAILED:', e.message);
}
