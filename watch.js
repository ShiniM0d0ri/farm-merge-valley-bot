// Poll live state and save a snapshot each time it changes.
// Play the game normally while this runs; every real action becomes its own snapshot.
//
//   node watch.js                  interval 3s, output to watch/
//   node watch.js 2                interval 2s
//   node watch.js 3 watch --for=60 stop after 60s (for testing)
import fs from 'node:fs';
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';
import { canonical } from './lib/deep.js';

const args = process.argv.slice(2);
const forArg = args.find((a) => a.startsWith('--for='));
const rest = args.filter((a) => !a.startsWith('--for='));
const interval = Number(rest[0] || 3) * 1000;
const dir = rest[1] || 'watch';
const deadline = forArg ? Date.now() + Number(forArg.split('=')[1]) * 1000 : Infinity;

fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const read = async () => decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const sigOf = (m) =>
  JSON.stringify(canonical(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.json]))));

const tilesOf = (m) => Object.keys(m).filter((k) => /^TilesStateModel_/.test(k)).length;

console.log(`watching every ${interval / 1000}s -> ${dir}/   (Ctrl+C to stop)`);
let last = null;
let n = 0;

// seed with the current state so the first diff has a baseline
try {
  const m = await read();
  last = sigOf(m);
  fs.writeFileSync(`${dir}/000.json`, JSON.stringify(m));
  console.log(`baseline -> ${dir}/000.json (${Object.keys(m).length} models, ${tilesOf(m)} tiles)`);
} catch (e) {
  console.log('baseline read failed:', e.message);
}

while (Date.now() < deadline) {
  let m;
  try {
    m = await read();
  } catch (e) {
    console.log(`[${new Date().toLocaleTimeString()}] read failed: ${e.message}`);
    await sleep(interval);
    continue;
  }
  const sig = sigOf(m);
  if (sig !== last) {
    last = sig;
    const file = `${dir}/${String(++n).padStart(3, '0')}.json`;
    fs.writeFileSync(file, JSON.stringify(m));
    console.log(`[${new Date().toLocaleTimeString()}] change #${n} -> ${file} (${Object.keys(m).length} models)`);
  }
  await sleep(interval);
}
console.log(`stopped. ${n} change(s) captured in ${dir}/`);
