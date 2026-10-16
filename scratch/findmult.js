import fs from 'node:fs';
const dir = './config/';

const pat = /multiplier|speed|timescale|time_scale|duration.*scale|scale.*duration/i;
const out = [];
const walk = (node, path) => {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  for (const [k, v] of Object.entries(node)) {
    if (pat.test(k)) out.push([`${path}.${k}`, typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : v]);
    walk(v, `${path}.${k}`);
  }
};

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  walk(j, f.replace('_jsonpack.json', ''));
}

const seen = new Set();
for (const [p, v] of out) {
  const sig = `${p.replace(/\[\d+\]/g, '[]')}=${v}`;
  if (seen.has(sig)) continue;
  seen.add(sig);
  console.log(`${p}  =  ${v}`);
}
console.log(`\n${out.length} hits, ${seen.size} distinct`);
