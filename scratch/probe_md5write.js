// Does the server validate md5, and does it store what we send?
// Test on an EMPTY tile model (state:null) - zero gameplay impact. Restores afterwards.
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf, encodeModelEntry } from '../lib/proto.js';

const s = loadSession();
const read = async () => decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

const before = await read();
const target = Object.values(before).find(
  (m) => m.key.startsWith('TilesStateModel_') && m.json && m.json.data?.state === null
);
if (!target) { console.log('no empty tile found'); process.exit(1); }
console.log('target:', target.key, JSON.stringify(target.json));
console.log('  stored md5:', target.md5);

const BOGUS = 'deadbeefdeadbeefdeadbeefdeadbeef';
console.log('\nwriting with md5 =', BOGUS, '(json unchanged)');
await httpRpc('SAVE_PLAYER_DATA_V2', encodeModelEntry(target.key, target.json, BOGUS, target.ts));

const after = await read();
console.log('  md5 after write:', after[target.key].md5);
console.log('  json after write:', JSON.stringify(after[target.key].json));
console.log('  md5 accepted as-is:', after[target.key].md5 === BOGUS);

console.log('\nrestoring original md5...');
await httpRpc('SAVE_PLAYER_DATA_V2', encodeModelEntry(target.key, target.json, target.md5, target.ts));
const final = await read();
console.log('  md5 now:', final[target.key].md5, '| restored:', final[target.key].md5 === target.md5);
