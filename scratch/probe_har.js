// Round-trip: decode a REAL SAVE_PLAYER_DATA_V2 payload from the HAR, re-encode,
// and byte-compare. Validates our protobuf encoder against ground truth.
import fs from 'node:fs';
import { decodeModels, b64ToBuf, encodeModelEntry } from '../lib/proto.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

let payload = null;
for (const e of har.log.entries) {
  for (const m of e._webSocketMessages || []) {
    if (m.type !== 'send') continue;
    try {
      const o = JSON.parse(m.data);
      if (o.rpc?.id === 'SAVE_PLAYER_DATA_V2' && o.rpc.payload) payload = o.rpc.payload;
    } catch {}
  }
}
const orig = b64ToBuf(payload);
console.log('reference payload: b64 len', payload.length, '-> bytes', orig.length);

const models = decodeModels(orig);
console.log('models in payload:', Object.keys(models).length);
for (const m of Object.values(models)) {
  console.log(`  ${m.key.padEnd(30)} json=${typeof m.json === 'string' ? 'STRING' : 'obj'} md5=${m.md5} ts=${m.ts}`);
}

const rebuilt = Buffer.concat(
  Object.values(models).map((m) => encodeModelEntry(m.key, m.json, m.md5, m.ts))
);
console.log('\nrebuilt bytes:', rebuilt.length, 'orig bytes:', orig.length);
console.log('identical:', rebuilt.equals(orig));
if (!rebuilt.equals(orig)) {
  const n = Math.min(rebuilt.length, orig.length);
  let i = 0;
  while (i < n && rebuilt[i] === orig[i]) i++;
  console.log('first diff at byte', i);
  console.log('  orig:', orig.subarray(Math.max(0, i - 20), i + 44).toString('hex'));
  console.log('  ours:', rebuilt.subarray(Math.max(0, i - 20), i + 44).toString('hex'));
}
