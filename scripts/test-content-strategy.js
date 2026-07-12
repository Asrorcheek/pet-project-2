'use strict';

const assert = require('assert');
const {
  createContentStrategyState,
  normalizeContentStrategyState,
  normalizeWeeklyPlan,
  parseCatalogCsv,
  uniqueHandles,
} = require('../content-strategy');

const catalog = parseCatalogCsv([
  'sku,name,price,specs,availability,active,image_urls,priority',
  'A1,"Laptop, Pro",$700,16GB RAM,in stock,true,https://example.com/a.jpg|https://example.com/b.jpg,10',
  'A2,Disabled,$1,,out_of_stock,false,,1',
].join('\n'));

assert.strictEqual(catalog.length, 1);
assert.strictEqual(catalog[0].name, 'Laptop, Pro');
assert.strictEqual(catalog[0].imageUrls.length, 2);
assert.strictEqual(createContentStrategyState('shadow').mode, 'shadow');
assert.deepStrictEqual(uniqueHandles(['@Shop.One', 'shop.one', 'bad handle']), ['shop.one']);
assert.deepStrictEqual(normalizeContentStrategyState({ mode: 'invalid' }, 'shadow').plans, []);

const plan = normalizeWeeklyPlan({
  items: [
    { pillar: 'product', title: 'A', sku: 'A1' },
    { pillar: 'education', format: 'carousel', title: 'B' },
    { pillar: 'education', format: 'carousel', title: 'C' },
    { pillar: 'branding', title: 'D' },
    { pillar: 'trend', title: 'E' },
  ],
}, { weekKey: '2026-07-20', chatId: '1', mode: 'shadow' });

assert.strictEqual(plan.items.length, 5);
assert.strictEqual(plan.items.filter((item) => item.pillar === 'product').length, 1);
assert.strictEqual(plan.items.filter((item) => item.pillar === 'education').length, 2);
assert.strictEqual(plan.items.filter((item) => item.pillar === 'branding').length, 1);
assert.strictEqual(plan.items.filter((item) => item.pillar === 'trend').length, 1);
assert.throws(() => normalizeWeeklyPlan({ items: plan.items.slice(0, 4) }), /exactly five/);

console.log('content-strategy tests passed');
