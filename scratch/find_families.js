import fs from 'node:fs';

const DIR = './config';
const files = ['progression_jsonpack.json', 'map_island.json', 'map_facebook.json', 'buildings_jsonpack.json'];

/** Walk and report any container whose JSON text contains "goat" AND "chicken". */
function walk(node, path, out, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  const text = JSON.stringify(node);
  if (text.includes('goat') && text.includes('chicken')) {
    out.push({ path, kind: Array.isArray(node) ? `array[${node.length}]` : 'object', preview: text.slice(0, 300) });
    return; // don't descend further, this is the interesting node
  }
  for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, out, depth + 1);
}

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf8'));
  const out = [];
  walk(j, f, out);
  console.log(`\n########## ${f}: ${out.length} candidate container(s)`);
  for (const o of out.slice(0, 8)) console.log(`  ${o.path}  ${o.kind}\n    ${o.preview.replace(/\s+/g, ' ')}\n`);
}
