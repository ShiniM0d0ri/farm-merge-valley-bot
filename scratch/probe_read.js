// Read the live board via HTTP RPC (no browser).
import fs from 'node:fs';
import { httpRpc, loadSession } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { printBoard, byBlueprint } from '../lib/board.js';

const session = loadSession();
const text = await httpRpc('GET_ALL_PLAYER_DATA_V2');
const models = decodeModels(b64ToBuf(text));

fs.writeFileSync('state.json', JSON.stringify(models, null, 1));
console.log('raw bytes:', text.length, '-> models:', Object.keys(models).length);
printBoard(models, { verbose: process.argv.includes('-v') });

console.log('\nmergeable groups:');
for (const [bp, list] of [...byBlueprint(models)].sort()) {
  const target = list[0].mergeable?.target;
  console.log(`  ${bp.padEnd(18)} x${String(list.length).padStart(3)}  -> ${target}`);
}
console.log('\nnon-tile models:');
for (const k of Object.keys(models).sort()) {
  if (!k.startsWith('TilesStateModel_')) console.log('  ' + k);
}
