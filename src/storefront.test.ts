// Render-level tests for the restyle/preview surface. Pure functions over a fake
// Catalog — no DB, no API keys. Run: pnpm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderShopPage, renderMenuImagePage } from './storefront.js';
import type { Catalog } from './catalog.js';
import type { Shop, ShopConfig } from './db/schema.js';

function shop(over: Partial<Shop> = {}): Shop {
  return {
    id: 1,
    slug: 'baeckerei-demo',
    phone: '+490000',
    name: 'Bäckerei Demo',
    tagline: 'Fresh daily',
    description: null,
    status: 'live',
    config: {},
    draftConfig: {},
    previewToken: null,
    createdAt: new Date(0),
    ...over,
  };
}

const products: Catalog['products'] = [
  { id: 1, shopId: 1, name: 'Brezn', description: null, priceCents: 120, currency: 'EUR', available: true, sort: 0, createdAt: new Date(0) },
];

const LIVE: ShopConfig = { css: '.menu{color:green}', moodPrompt: 'm' };
const DRAFT: ShopConfig = {
  css: '.menu{color:red}',
  moodPrompt: 'rustic',
  headerImage: { dataBase64: 'AAAA', mime: 'image/png' },
  menuImage: { dataBase64: 'BBBB', mime: 'image/png' },
};

test('live view applies live css, no preview banner, no draft hooks', () => {
  const html = renderShopPage({ shop: shop({ config: LIVE, draftConfig: DRAFT, previewToken: 'tok' }), products });
  assert.ok(html.includes('.menu{color:green}'), 'live css present');
  assert.ok(!html.includes('.menu{color:red}'), 'draft css absent');
  assert.ok(!html.includes('Preview'), 'no preview banner on live view');
  assert.ok(!html.includes('class="hero"'), 'no hero (live has no headerImage)');
});

test('valid preview token renders the draft look + banner + toggle', () => {
  const html = renderShopPage(
    { shop: shop({ config: LIVE, draftConfig: DRAFT, previewToken: 'tok' }), products },
    'tok',
  );
  assert.ok(html.includes('.menu{color:red}'), 'draft css present');
  assert.ok(html.includes('👀 <strong>Preview.'), 'preview banner present');
  assert.ok(html.includes("/s/baeckerei-demo/header?preview=tok"), 'hero points at preview banner');
  assert.ok(html.includes('preview=tok&view=image'), 'printable-menu toggle preserves preview');
});

test('wrong preview token falls back to the live look (drafts are gated)', () => {
  const html = renderShopPage(
    { shop: shop({ config: LIVE, draftConfig: DRAFT, previewToken: 'tok' }), products },
    'wrong',
  );
  assert.ok(html.includes('.menu{color:green}'), 'live css served');
  assert.ok(!html.includes('.menu{color:red}'), 'draft never leaks without the token');
});

test('custom css is sanitized at render time (defence in depth)', () => {
  const evil: ShopConfig = { css: '.x{}</style><script>alert(1)</script>' };
  const html = renderShopPage({ shop: shop({ config: evil }), products });
  assert.ok(!html.includes('</style><script>'), 'breakout neutralised in output');
});

test('printable menu page serves the poster image with a back/print toggle', () => {
  const html = renderMenuImagePage(
    { shop: shop({ config: LIVE, draftConfig: DRAFT, previewToken: 'tok' }), products },
    'tok',
  );
  assert.ok(html.includes('/s/baeckerei-demo/menu.png?preview=tok'), 'poster image src present');
  assert.ok(html.includes('window.print()'), 'print button present');
});
