// Labeled snapshot of live game state.  Usage: node snap.js <label>
import fs from 'node:fs';
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';

const label = (process.argv[2] || 'snap').replace(/[^\w.-]/g, '_');
fs.mkdirSync('snaps', { recursive: true });

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const path = `snaps/${label}.json`;
fs.writeFileSync(path, JSON.stringify(models));
console.log(`wrote ${path} (${Object.keys(models).length} models)`);
