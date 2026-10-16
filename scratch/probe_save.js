// SAVE_PLAYER_DATA_V2 round-trip: what does it return, and did our write stick?
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf, encodeModelEntry, parseFields } from '../lib/proto.js';

const s = loadSession();
const read = async () => decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

const before = await read();
const target = Object.values(before).find((m) => m.key.startsWith('TilesStateModel_') && m.json);
console.log('target:', target.key, JSON.stringify(target.json));
console.log('  stored md5:', target.md5, ' ts:', target.ts);

const payload = encodeModelEntry(target.key, target.json, target.md5, target.ts);
const res = await httpRpc('SAVE_PLAYER_DATA_V2', payload);
console.log('\nSAVE b64:', res.slice(0, 200));

const buf = b64ToBuf(res);
console.log('SAVE bytes:', buf.length, buf.subarray(0, 40).toString('hex'));
console.log('top-level fields:');
for (const f of parseFields(buf)) {
  const val = f.wt === 2 ? `len=${f.v.length} ${f.v.subarray(0, 60).toString('utf8').replace(/[^\x20-\x7e]/g, '.')}` : String(f.v);
  console.log(`   field=${f.f} wt=${f.wt} ${val}`);
}

const after = await read();
const same = JSON.stringify(before[target.key].json) === JSON.stringify(after[target.key].json);
console.log('\nvalue unchanged after re-save:', same);
console.log('md5 before/after:', before[target.key].md5, '/', after[target.key].md5);
console.log('models before/after:', Object.keys(before).length, '/', Object.keys(after).length);
