import fs from 'node:fs';
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

console.log('GET_SERVER_TIME ->', JSON.stringify(await httpRpc('GET_SERVER_TIME')).slice(0, 200));
console.log('local now       ->', Date.now());

const m = JSON.parse(fs.readFileSync('state.json', 'utf8'));
console.log('\nGameWorkersModel:', JSON.stringify(m.GameWorkersModel?.json));
console.log('WorldToLifeModel:', JSON.stringify(m.WorldToLifeModel?.json));
const timers = m.TimerModel?.json?.data;
console.log('nextTimerId:', timers?.nextTimerId, '| timers:', timers?.timers?.length);
for (const t of timers?.timers || []) console.log('   ', JSON.stringify(t));
