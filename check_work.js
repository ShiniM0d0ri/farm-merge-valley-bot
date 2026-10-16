import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const now = Date.now();

const inv = models.InventoryModel?.json?.data;
console.log(`level=${inv?.level} exp=${inv?.exp} coins=${inv?.coins} energy=${inv?.energy}`);
const st = models.UserStatsModel?.json?.data;
console.log(`totalSpentEnergy=${st?.totalSpentEnergy}  totalMinedRocks=${st?.totalMinedRocks}  totalChoppedTrees=${st?.totalChoppedTrees}`);

console.log('\nMapSource timers:');
for (const x of models.TimerModel?.json?.data?.timers || []) {
  if (!/MapSource/.test(String(x.label))) continue;
  const left = Math.round((x.started + x.duration - now) / 1000);
  console.log(`  id=${x.id} ${x.label} cooldown=${x.duration / 1000}s  ${left > 0 ? `${left}s left` : `expired ${-left}s ago`}`);
}
console.log('nextTimerId =', models.TimerModel?.json?.data?.nextTimerId);

console.log('\ntiles with a dispatched worker:');
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_')) continue;
  const s = m.json?.data?.state?.state ?? m.json?.data?.state;
  if (!s?.data?.workerData) continue;
  console.log(`  ${k} ${s.blueprint} ${JSON.stringify(s.data)}`);
}

console.log('\nresource tiles:');
for (const [k, m] of Object.entries(models)) {
  if (!k.startsWith('TilesStateModel_')) continue;
  const s = m.json?.data?.state;
  if (!s?.data?.resourceGate) continue;
  const hp = s.data.hitpoints;
  console.log(`  ${k} ${s.blueprint} step ${hp.max - hp.current + 1}/${hp.max} gate=${JSON.stringify(s.data.resourceGate)}`);
}
