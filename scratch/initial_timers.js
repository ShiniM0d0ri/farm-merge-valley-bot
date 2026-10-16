// scratch/initial_timers.js - hunt the tier-4 producer cooldown timers in the capture's READS.
//
// SAVE_PLAYER_DATA_V2 payloads are PARTIAL (only the models that changed), so "timer 2129 is in no
// save payload" does not prove the timer never existed on the server. The full state arrives in the
// session's initial read (GET_ALL_PLAYER_DATA / _V2 / GET_PLAYER_DATA_V2). Scan those responses -
// HTTP and WebSocket - and report every TimerModel seen, with room for the producer ids.
import fs from 'node:fs';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const HAR = process.env.FMV_HAR || './capture_launch.har';
const WANT = (process.env.FMV_IDS || '2115,2116,2120,2123,2126,2129').split(',').map(Number);
const READ = /rpc\/(GET_ALL_PLAYER_DATA_V2|GET_ALL_PLAYER_DATA|GET_PLAYER_DATA_V2|GET_PLAYER_DATA)/i;
const READ_ID = /^(GET_ALL_PLAYER_DATA_V2|GET_ALL_PLAYER_DATA|GET_PLAYER_DATA_V2|GET_PLAYER_DATA)$/i;
const har = JSON.parse(fs.readFileSync(HAR, 'utf8'));

const tryDecode = (text) => {
  if (!text || typeof text !== 'string') return null;
  try { return decodeModels(b64ToBuf(text)); } catch { return null; }
};

const report = (where, models) => {
  if (!models) return;
  const tm = models.TimerModel?.json?.data;
  if (!tm) return;
  const ids = (tm.timers || []).map((t) => t.id);
  const hits = WANT.filter((w) => ids.includes(w));
  console.log(`\n${where}`);
  console.log(`  models=${Object.keys(models).length}  timers=${ids.length}  nextTimerId=${tm.nextTimerId}  range ${Math.min(...ids)}..${Math.max(...ids)}`);
  if (hits.length) {
    console.log(`  *** PRODUCER TIMER IDS PRESENT: ${hits.join(', ')}`);
    for (const t of tm.timers) if (WANT.includes(t.id)) console.log(`      ${JSON.stringify(t)}`);
  } else {
    console.log(`  producer ids ${WANT.join(',')}: absent`);
  }
  // label histogram, to see what a producer timer would be called
  const labels = {};
  for (const t of tm.timers) labels[String(t.label).replace(/[0-9]+/g, '#')] = (labels[String(t.label).replace(/[0-9]+/g, '#')] || 0) + 1;
  console.log(`  labels: ${Object.entries(labels).map(([k, v]) => `${k}x${v}`).join(' ')}`);
};

let n = 0;
for (const e of har.log.entries) {
  const url = e.request?.url || '';
  if (READ.test(url)) {
    const text = e.response?.content?.text;
    const tMs = Date.parse(e.startedDateTime);
    const models = tryDecode(text);
    if (models) { report(`[http ${new Date(tMs).toISOString()}] ${url.split('/').pop()} (${String(text.length)} chars, ${Object.keys(models).length} models)`, models); n++; }
    else console.log(`[http ${new Date(tMs).toISOString()}] ${url.split('/').pop()}: undecodable response (${text ? text.length : 0} chars)`);
  }
  for (const m of e._webSocketMessages || []) {
    let o;
    try { o = JSON.parse(m.data); } catch { continue; }
    const id = o?.rpc?.id || '';
    if (!READ_ID.test(id) || m.type !== 'receive') continue;
    const models = tryDecode(o.rpc.payload);
    const when = new Date(Math.round((m.time || 0) * 1000)).toISOString();
    if (models) { report(`[ws ${when}] ${id}`, models); n++; }
    else console.log(`[ws ${when}] ${id}: undecodable (${o.rpc.payload ? o.rpc.payload.length : 0} chars)`);
  }
}
console.log(`\n${n} decodable read(s)`);
