// Prove the game's real transport works from Node: raw Nakama WebSocket RPC.
import { wsRpc, loadSession } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { printBoard } from '../lib/board.js';

const session = loadSession();
const t0 = Date.now();
const res = await wsRpc(
  [
    { id: 'GET_SERVER_TIME' },
    { id: 'GET_ALL_PLAYER_DATA_V2' },
  ],
  { log: true }
);
console.log('\nround-trip:', Date.now() - t0, 'ms');

const time = b64ToBuf(res.GET_SERVER_TIME.payload);
console.log('GET_SERVER_TIME payload b64:', res.GET_SERVER_TIME.payload);

const models = decodeModels(b64ToBuf(res.GET_ALL_PLAYER_DATA_V2.payload));
console.log('GET_ALL_PLAYER_DATA_V2 -> models:', Object.keys(models).length);
printBoard(models);
