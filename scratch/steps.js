import fs from 'node:fs';
const dir = './config/';
const j = JSON.parse(fs.readFileSync(dir + 'blueprints_jsonpack.json', 'utf8'));

// find step-array paths: arrays whose items have cost+duration+rewards
const found = [];
const walk = (node, path) => {
  if (Array.isArray(node)) {
    if (node.length && node.every((v) => v && typeof v === 'object' && 'cost' in v && 'duration' in v)) {
      found.push([path, node]);
      return;
    }
    node.forEach((v, i) => walk(v, `${path}[${i}]`));
  } else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) walk(node[k], path ? `${path}.${k}` : k);
  }
};
walk(j, '');

const onTopic = /stone|wood|tool/i;
for (const [path, arr] of found) {
  const blob = JSON.stringify(arr);
  if (!onTopic.test(blob)) continue;
  console.log(`\n===== ${path}  (${arr.length} steps) =====`);
  for (const [i, s] of arr.entries()) {
    console.log(`  step ${i + 1}: cost=${s.cost} duration=${s.duration} rewards=${JSON.stringify(s.rewards)}${s.workers !== undefined ? ` workers=${s.workers}` : ''}`);
  }
}
console.log(`\n(${found.length} step-arrays total)`);
