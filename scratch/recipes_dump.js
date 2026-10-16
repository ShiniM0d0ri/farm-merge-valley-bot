import { loadRecipes, loadBuildings } from '../orders.js';

const recipes = loadRecipes();
const buildings = loadBuildings();

console.log('workshops:');
for (const [key, b] of Object.entries(buildings)) {
  if (!key.endsWith('_config') || !b?.isWorkshop) continue;
  console.log(
    `  ${String(b.ID).padEnd(10)} cooldown=${JSON.stringify(b.cooldown)}  recipes=${(b.availableRecipes || []).length}`
  );
}

console.log('\nrecipes:');
for (const [rid, r] of Object.entries(recipes)) {
  if (!r || typeof r.duration !== 'number') continue;
  const ing = (r.ingredients || []).map((i) => `${i.amount} ${i.key}`).join(' + ');
  console.log(`  ${rid.padEnd(34)} dur=${String(r.duration).padStart(5)}  ${ing.padEnd(28)} -> ${(r.reward || []).join(',')}`);
}
