import fs from 'node:fs';
for (const f of ['har_saves.json', 'har_saves_levelup.json']) {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log(`${f}: ${s.length} saves, t[0]=${s[0]?.t}, t[last]=${s[s.length - 1]?.t}`);
  const withT = s.filter((x) => x.t).length;
  console.log(`   with timestamp: ${withT}`);
}
