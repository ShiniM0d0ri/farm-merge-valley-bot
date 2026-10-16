// How is each model's md5 derived? Test candidates against every model we can read.
import crypto from 'node:crypto';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const s = loadSession();
const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

const cands = {
  'md5(rawJson)': (m) => m.rawJson,
  'md5(JSON.stringify(json))': (m) => Buffer.from(JSON.stringify(m.json), 'utf8'),
  'md5(key)': (m) => Buffer.from(m.key, 'utf8'),
  'md5(key+rawJson)': (m) => Buffer.concat([Buffer.from(m.key, 'utf8'), m.rawJson]),
  'md5(rawJson+key)': (m) => Buffer.concat([m.rawJson, Buffer.from(m.key, 'utf8')]),
};

const score = {};
for (const name of Object.keys(cands)) score[name] = 0;
let total = 0;

for (const m of Object.values(models)) {
  if (!m.md5 || !m.rawJson) continue;
  total++;
  for (const [name, fn] of Object.entries(cands)) {
    if (md5(fn(m)) === m.md5) score[name]++;
  }
}
console.log('models with md5:', total);
for (const [name, n] of Object.entries(score)) {
  console.log(`  ${name.padEnd(28)} ${n}/${total} match`);
}

// show raw json of a couple of models so we can see exact formatting
let shown = 0;
for (const m of Object.values(models)) {
  if (!m.rawJson || shown++ >= 2) continue;
  console.log(`\n${m.key} stored md5=${m.md5}`);
  console.log('  rawJson:', JSON.stringify(m.rawJson.toString('utf8')).slice(0, 220));
  console.log('  stringify:', JSON.stringify(JSON.stringify(m.json)).slice(0, 220));
}
