import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../app/meals/page.tsx', import.meta.url), 'utf8');
function handler(name: string, nextComment: string, ctx: Record<string, unknown>) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(nextComment, start);
  assert.ok(start > 0 && end > start);
  const fn = source.slice(start, end).trim()
    .replace('(dayIndex: number, navigationRecipeId?: string | null)', '(dayIndex, navigationRecipeId)')
    .replace('(dayIndex: number)', '(dayIndex)');
  return new Function('ctx', `with(ctx) { return (${fn}); }`)(ctx);
}
function setup(locked = false, selected: unknown = null) {
  const slot = { recipeId: 'pasta', recipeName: 'Pasta', dayOfWeek: 'Sunday', meal: { main: { id: 'pasta' }, sides: [{ id: 'salad' }], serveWith: ['Bread'] }, brunch: { main: { id: 'eggs' } } };
  const plan = { locked, days: [slot] };
  const paths: string[] = [];
  const saves: any[] = [];
  const selections: unknown[] = [];
  const ctx = { planLoading: false, plan, selectedRecipe: selected, router: { push: (path: string) => paths.push(path) }, isRecipeOnFile: (id: string) => ['pasta', 'eggs'].includes(id), hasBrunchSlot: () => true, buildEmptyPlan: () => plan, touchPlan: (p: unknown) => p, persistPlan: (p: unknown) => saves.push(p), setSelectedRecipe: (p: unknown) => selections.push(p) };
  return { ctx, paths, saves, selections, plan };
}
for (const locked of [false, true]) {
  test(`assigned main opens without writes, locked=${locked}`, () => {
    const h = setup(locked); const before = JSON.stringify(h.plan);
    handler('handleSlotClick', '// Assign recipe to the weekend', h.ctx)(0, 'pasta');
    assert.deepEqual(h.paths, ['/recipes/pasta?from=%2Fmeals']);
    assert.equal(h.saves.length, 0); assert.equal(JSON.stringify(h.plan), before);
  });
  test(`assigned brunch opens without writes, locked=${locked}`, () => {
    const h = setup(locked);
    handler('handleBrunchSlotClick', '// Clear a day slot', h.ctx)(0);
    assert.deepEqual(h.paths, ['/recipes/eggs?from=%2Fmeals']); assert.equal(h.saves.length, 0);
  });
}
test('selecting a new main still assigns it and preserves accompaniments', () => {
  const h = setup(false, { id: 'new', name: 'New meal' });
  handler('handleSlotClick', '// Assign recipe to the weekend', h.ctx)(0);
  assert.equal(h.saves[0].days[0].recipeId, 'new');
  assert.deepEqual(h.saves[0].days[0].meal.sides, [{ id: 'salad' }]);
  assert.deepEqual(h.saves[0].days[0].meal.serveWith, ['Bread']);
  assert.deepEqual(h.selections, [null]); assert.equal(h.paths.length, 0);
});
test('locked plans reject assignment for both lanes', () => {
  const h = setup(true, { id: 'new', name: 'New meal' });
  handler('handleSlotClick', '// Assign recipe to the weekend', h.ctx)(0);
  handler('handleBrunchSlotClick', '// Clear a day slot', h.ctx)(0);
  assert.equal(h.saves.length, 0); assert.equal(h.paths.length, 0);
});
test('title-only history cannot navigate an unrelated planned recipe', () => {
  const h = setup(); handler('handleSlotClick', '// Assign recipe to the weekend', h.ctx)(0, null);
  assert.equal(h.paths.length, 0); assert.equal(h.saves.length, 0);
});
test('assigned shelf cards remain readable, but duplicate assignment stays disabled', () => {
  const card = source.slice(source.indexOf('function RecipeCard('), source.indexOf('// ----- Complement Picker'));
  assert.ok(!card.includes('pointer-events-none'));
  assert.ok(card.includes('disabled={isAssigned}'));
  assert.ok(card.includes('View recipe'));
});
test('weekend background resolves the brunch-only assignment and main clicks stop bubbling', () => {
  assert.ok(source.includes('handleSlotClick(i, dayNavigationRecipeId)'));
  assert.match(source, /const dayNavigationRecipeId = navigationRecipeId \?\?[\s\S]*?!isFilled && brunchSlot\?\.main\?\.id/);
  assert.match(source, /e\.stopPropagation\(\);\s+if \(isClickable\) handleSlotClick\(i, navigationRecipeId\)/);
});
