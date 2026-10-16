import { loadSession, httpRpc } from '../lib/nakama.js';
import { b64ToBuf } from '../lib/proto.js';

for (const rid of ['GET_ACTIVE_TIMED_CONFIGURATIONS', 'GET_CONFIGURATIONS']) {
  try {
    const t = await httpRpc(rid);
    console.log(`\n### ${rid} -> ${t.length} chars`);
    console.log(t.slice(0, 700));
  } catch (e) {
    console.log(`\n### ${rid} -> ERROR ${e.message}`);
  }
}
