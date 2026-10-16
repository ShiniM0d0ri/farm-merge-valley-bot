// Inspect the timer table and correlate it with tile state.
//   node timers.js            report
//   node timers.js --all      dump every timer
import { loadSession, httpRpc } from './lib/nakama.js';
import { decodeModels, b64ToBuf } from './lib/proto.js';

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const timers = models.TimerModel?.json?.data?.timers || [];
const nextId = models.TimerModel?.json?.data?.nextTimerId;
const now = Date.now();

console.log(`now=${now}  nextTimerId=${nextId}  timers=${timers.length}\n`);

const byId = new Map(timers.map((t) => [t.id, t]));
const shown = new Map();
for (const t of timers) shown.set(t.label, (shown.get(t.label) || 0) + 1);
console.log('labels:');
for (const [l, n] of [...shown].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${l}`);

if (process.argv.includes('--all')) {
  console.log('\nall timers:');
  for (const t of timers) {
    const end = t.started + t.duration;
    const rem = end - now;
    console.log(
      `  id=${t.id} ${t.state} ${String(rem > 0 ? `in ${Math.round(rem / 1000)}s` : `done ${Math.round(-rem / 1000)}s ago`).padStart(20)}  dur=${t.duration}  ${t.label}`
    );
  }
}

console.log('\ntiles referencing a timer:');
let refs = 0;
let dangling = 0;
for (const [key, m] of Object.entries(models)) {
  if (!key.startsWith('TilesStateModel_')) continue;
  const st = m.json?.data?.state;
  if (!st?.data) continue;
  const [row, col] = key.slice('TilesStateModel_'.length).split(':');
  for (const comp of ['cooldown', 'resourceGate']) {
    const c = st.data[comp];
    if (!c?.timerId) continue;
    refs++;
    const t = byId.get(c.timerId);
    if (!t) {
      dangling++;
      console.log(`  (${row},${col}) ${st.blueprint}.${comp} timerId=${c.timerId}  ** NOT IN TimerModel **`);
      continue;
    }
    const rem = t.started + t.duration - now;
    const age = now - t.started;
    console.log(
      `  (${row},${col}) ${st.blueprint}.${comp} timerId=${c.timerId} [${t.label}] dur=${t.duration} age=${Math.round(age / 1000)}s ${rem > 0 ? `remaining ${Math.round(rem / 1000)}s` : `READY ${Math.round(-rem / 1000)}s ago`}  ${t.state}`
    );
  }
}
console.log(`\n${refs} tile->timer refs, ${dangling} dangling`);

const producers = [];
for (const [key, m] of Object.entries(models)) {
  if (!key.startsWith('TilesStateModel_')) continue;
  const st = m.json?.data?.state;
  if (!st?.data) continue;
  const [row, col] = key.slice('TilesStateModel_'.length).split(':');
  const has = (c) => !!st.data[c];
  producers.push({ row, col, bp: st.blueprint, cooldown: has('cooldown'), lootable: has('lootable'), dep: has('depleted') });
}
const cool = producers.filter((p) => p.cooldown);
console.log(`producer-like tiles: cooldown=${cool.length} lootable=${producers.filter((p) => p.lootable).length} depleted=${producers.filter((p) => p.dep).length}`);
