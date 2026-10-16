// scratch/daily_tasks.js - live DailyChallengeModel targets + TimedEventModel quests, so we can see
// which of OUR actions (merge / loot / harvest / work / order) should advance a counter.
import { httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));

const dc = models.DailyChallengeModel?.json;
console.log('=== DailyChallengeModel ===');
console.log(`version=${dc?.version}`);
for (const t of dc?.data?.targets || []) {
  console.log(`  #${String(t.id).padEnd(3)} ${String(t.task).padEnd(16)} ${String(t.currentAmount).padStart(4)}/${String(t.targetAmount).padEnd(4)} collected=${String(t.collected).padEnd(5)} reward=${t.reward?.data?.key} x${t.reward?.data?.amount} (${t.localizedTask})`);
}
console.log('  other keys: ' + Object.keys(dc?.data || {}).filter((k) => k !== 'targets').join(', '));
console.log('  raw non-target fields: ' + JSON.stringify(Object.fromEntries(Object.entries(dc?.data || {}).filter(([k]) => k !== 'targets'))));

console.log('\n=== TimedEventModel ===');
const te = models.TimedEventModel?.json?.data || {};
for (const [k, ev] of Object.entries(te)) {
  const q = ev?.eventData?.activeQuest;
  console.log(` ${k}: quest=${q ? JSON.stringify({ ...q.data, progress: q.progress }) : 'none'}`);
  console.log(`    eventData keys=${Object.keys(ev?.eventData || {}).join(',')}`);
}
