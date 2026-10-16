// scratch/producer_timer_removal.js - does materialising a producer delete its Cooldown timer?
//
// Producer tiles reference `cooldown.timerId` = a TimerModel entry labelled `Cooldown:<row>,<col>`.
// Materialisation is client-side (the timer elapses -> the tile gains `lootable`). Whether the spent
// timer is then DELETED from TimerModel decides what the bot must write: leaving a spent timer behind
// would accumulate forever, deleting one the client keeps would diverge from the server state.
import fs from 'node:fs';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const WANT = (process.env.FMV_IDS || '2115,2116,2120,2123,2126,2129').split(',').map(Number);
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const rows = [];
har.log.entries.forEach((e) => {
  (e._webSocketMessages || []).forEach((m) => {
    if (m.type !== 'send') return;
    let o;
    try { o = JSON.parse(m.data); } catch { return; }
    if (o?.rpc?.id !== 'SAVE_PLAYER_DATA_V2' || !o.rpc.payload) return;
    let models;
    try { models = decodeModels(b64ToBuf(o.rpc.payload)); } catch { return; }
    const tm = models.TimerModel?.json?.data;
    if (!tm) return;
    rows.push({ tMs: Math.round((m.time || 0) * 1000), ids: (tm.timers || []).map((t) => t.id), next: tm.nextTimerId, labels: (tm.timers || []).filter((t) => /^Cooldown:/.test(t.label)).map((t) => t.label) });
  });
});
rows.sort((a, b) => a.tMs - b.tMs);

const t0 = 1792142658207;
console.log(`saves carrying TimerModel: ${rows.length}\n`);
for (const r of rows) {
  const hits = WANT.filter((w) => r.ids.includes(w));
  console.log(`t+${String(((r.tMs - t0) / 1000).toFixed(1)).padStart(7)}s  next=${r.next}  count=${r.ids.length}  producerIds=[${hits.join(',')}]  Cooldown: labels=[${r.labels.join(' ')}]`);
}
console.log('\n(ids 2115-2129 appear only while the producers are un-materialised; if they vanish from the');
console.log(' first TimerModel save AFTER materialisation, the client deletes the spent timer.)');
