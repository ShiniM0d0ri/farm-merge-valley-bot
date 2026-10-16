// Inspect the raw GET_CONFIGURATIONS response shape.
import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { b64ToBuf, parseFields } from '../lib/proto.js';

const s = loadSession();
const res = await httpRpc('GET_CONFIGURATIONS');
const buf = b64ToBuf(res);
console.log('b64 len', res.length, '-> bytes', buf.length);
console.log('head hex:', buf.subarray(0, 32).toString('hex'));
console.log('head utf8:', JSON.stringify(buf.subarray(0, 200).toString('utf8')));

try {
  const f = parseFields(buf);
  console.log('top fields:', f.length);
  for (const x of f.slice(0, 8)) {
    console.log(`  field=${x.f} wt=${x.wt} ${x.wt === 2 ? 'len=' + x.v.length : x.v}`);
  }
} catch (e) {
  console.log('protobuf parse failed:', e.message);
}
try {
  const j = JSON.parse(buf.toString('utf8'));
  console.log('it is plain JSON; top keys:', Object.keys(j));
  fs.writeFileSync('configurations.json', JSON.stringify(j, null, 1));
  console.log('saved configurations.json');
} catch {
  console.log('not plain JSON');
  fs.writeFileSync('configurations.bin', buf);
  console.log('saved configurations.bin');
}
