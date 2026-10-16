import fs from 'node:fs';
const dir = './config/';

const hit = (s) => typeof s === 'string' && /source|resourceGate|steps/i.test(s);

for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  for (const [k, v] of Object.entries(j)) {
    const blob = JSON.stringify(v);
    if (/resourceGate|"steps"|mapSource/i.test(blob)) {
      console.log(`\n===== ${f} :: ${k}  (${blob.length} bytes) =====`);
      console.log(JSON.stringify(v, null, 1).slice(0, 1500));
    }
  }
}
