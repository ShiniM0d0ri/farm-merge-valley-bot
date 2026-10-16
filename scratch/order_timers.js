import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const saves = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'har_saves.json'), 'utf8'));

let prev = new Map();
console.log('save | Order_* / Cooldown_* timers (id:label:dur)  [changes only]\n');
for (const s of saves) {
  const timers = s.models?.TimerModel?.json?.data?.timers || [];
  const cur = new Map(
    timers
      .filter((t) => /^(Order_|Cooldown_)/.test(t.label))
      .map((t) => [t.id, `${t.id}:${t.label}:${t.duration}`])
  );
  const added = [...cur].filter(([id]) => !prev.has(id)).map(([, v]) => `+${v}`);
  const gone = [...prev].filter(([id]) => !cur.has(id)).map(([, v]) => `-${v}`);
  const orders = (s.models?.OrdersModel?.json?.data || [])
    .map((o) => `${o.buildingID}:${o.state}${o.timerId !== undefined ? `(t${o.timerId})` : ''}`)
    .join(' ');
  const nextId = s.models?.TimerModel?.json?.data?.nextTimerId;
  if (added.length || gone.length || s.models?.OrdersModel) {
    console.log(
      `[${String(s.seq).padStart(2)}] next=${nextId}  ${added.join(' ') || ''} ${gone.join(' ') || ''}`.padEnd(78) +
        ` orders: ${orders}`
    );
  }
  prev = cur;
}
