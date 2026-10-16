import fs from 'node:fs';
const dir = './config/';

const walk = (node, path, out) => {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.includes('cost') && keys.includes('duration')) out.push([path, node]);
    for (const k of keys) walk(node[k], `${path}.${k}`, out);
  }
};

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
  const out = [];
  walk(j, f.replace('_jsonpack.json', ''), out);
  if (out.length) {
    const uniq = [...new Set(out.map((o) => JSON.stringify(o[1])))];
    console.log(`\n===== ${f}: ${out.length} cost+duration objects, ${uniq.length} distinct =====`);
    for (const u of uniq.slice(0, 12)) console.log('  ' + u);
  }
}
