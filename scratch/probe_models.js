// Inventory the non-tile models so we know what a merge must update besides tiles.
import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const s = loadSession();
const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
fs.writeFileSync('state.json', JSON.stringify(models, null, 1));

console.log('total models:', Object.keys(models).length);
const nonTile = Object.entries(models).filter(([k]) => !k.startsWith('TilesStateModel_'));
console.log('non-tile models:', nonTile.length, '\n');

for (const [k, v] of nonTile.sort((a, b) => a[0].localeCompare(b[0]))) {
  const j = v.json;
  const txt = JSON.stringify(j);
  console.log(`${k}  (${txt.length}b)`);
  console.log('   ' + txt.slice(0, 240));
}
