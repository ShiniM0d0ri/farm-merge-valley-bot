// Compare our intended writes against what the server actually stored.
// Uses state.json (pre-merge snapshot) as the "before" state.
import fs from 'node:fs';
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';
import { loadBlueprints, loadProgression } from './lib/blueprints.js';
import { planMerges, buildUpdates } from './lib/solver.js';
import { deepEqual } from './lib/deep.js';

const s = loadSession();
const before = JSON.parse(fs.readFileSync('state.json', 'utf8'));
// rehydrate: state.json holds {key, json, md5, ts}
const models = {};
for (const [k, v] of Object.entries(before)) models[k] = v;

const bps = loadBlueprints();
const progression = loadProgression();
const moves = planMerges(models, { minMerge: 3, bps });
const { updates } = buildUpdates(models, moves, { bps, progression });
console.log('planned updates:', updates.size);

const now = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

let same = 0, diff = 0;
for (const [k, intended] of updates) {
  const actual = now[k]?.json;
  if (deepEqual(intended, actual)) { same++; continue; }
  diff++;
  console.log(`\nDIFF ${k}`);
  console.log('  intended:', JSON.stringify(intended).slice(0, 300));
  console.log('  stored  :', JSON.stringify(actual).slice(0, 300));
}
console.log(`\nidentical ${same}, different ${diff}`);
