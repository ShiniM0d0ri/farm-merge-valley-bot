// scratch/regen_status.js - live regeneration report.
//
// RegenerationServiceModel holds one entry per generator: {timerId, lastStartTime}. The paired
// TimerModel timer is labelled `regenerate_<name>` and carries the duration, so we can say whether a
// generator is currently ready. If a generator is PAST DUE and the matching counter has not grown,
// then regeneration is NOT applied by the server and the client has to write it (like every other
// reward) - which is what decides whether the bot needs to implement it.
import { loadSession, httpRpc } from '../lib/nakama.js';
import { decodeModels, b64ToBuf } from '../lib/proto.js';
import { GENERATORS, NOT_AUTOMATED } from '../lib/regen.js';

// duration comes from the paired `regenerate_<name>` timer. Only generators whose duration we
// actually know (automated ones + documented non-automated ones) can be judged, so merge the two
// tables and say "unknown" rather than inventing a duration when neither the timer nor the table
// has one - the per-minute `*_generator` entries have no timer while idle, and guessing a
// duration there produced a bogus "overdue 86069s" report.
const KNOWN = {};
for (const g of [...GENERATORS, ...NOT_AUTOMATED]) KNOWN[g.name] = g;

const models = decodeModels(b64ToBuf(await httpRpc('GET_ALL_PLAYER_DATA_V2')));
const regen = models.RegenerationServiceModel?.json?.data || {};
const timers = models.TimerModel?.json?.data?.timers || [];
const inv = models.InventoryModel?.json?.data || {};
const stock = models.MarketplaceModel?.json?.data?.stock || {};
const now = Date.now();

console.log(`now = ${new Date(now).toISOString()}`);
console.log(`counters: crates ${inv.crates} energy ${inv.energy} gems ${inv.gems} tle ${inv.time_limited_event_energy}`);
console.log(`stock   : ${Object.entries(stock).filter(([k]) => /_no_ads$/.test(k)).map(([k, v]) => `${k}=${v}`).join('  ')}`);
console.log('');

const byLabel = new Map();
for (const t of timers) if (String(t.label).startsWith('regenerate_')) byLabel.set(String(t.label).slice('regenerate_'.length), t);

for (const [name, v] of Object.entries(regen)) {
  if (!v || (!v.timerId && !v.lastStartTime)) continue;
  const t = byLabel.get(name);
  const known = KNOWN[name];
  const dur = t?.duration ?? known?.durationMs ?? 0;
  let when = dur ? '' : 'unknown duration';
  if (dur && v.lastStartTime) {
    const diff = v.lastStartTime + dur - now;
    when = diff <= 0 ? `READY (overdue ${Math.round(-diff / 1000)}s)` : `ready in ${Math.round(diff / 1000)}s`;
  }
  const auto = known && GENERATORS.includes(known) ? 'AUTO ' : '     ';
  const held = typeof stock[name] === 'number' ? `stock ${stock[name]}` : 'stock -';
  const label = known?.reward || (known ? `non-automated: ${known.reason}` : 'not in table');
  console.log(
    `  ${auto}${name.padEnd(22)} timerId ${String(v.timerId).padEnd(6)} ${held.padEnd(9)} ` +
    `lastStart ${v.lastStartTime ? new Date(v.lastStartTime).toISOString().slice(11, 19) : '-'}  ` +
    `dur ${String(dur).padStart(9)}  ${when.padEnd(26)}  ${label}`
  );
}
