// The storefront's human + agent faces (M3): server-rendered HTML at /s/:slug
// with schema.org JSON-LD, a plain-text llms.txt per shop, and a static A2A-style
// agent card. No template engine, no client JS — plain and fast on purpose.

import type { Express, Request, Response } from 'express';
import { PUBLIC_BASE_URL } from './env.js';
import { euro } from './format.js';
import { getShopWithCatalog, type Catalog } from './catalog.js';

/** Escape text for safe interpolation into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** schema.org LocalBusiness + product offers, for the page <head>. */
function jsonLd({ shop, products }: Catalog): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: shop.name,
    ...(shop.tagline ? { slogan: shop.tagline } : {}),
    ...(shop.description ? { description: shop.description } : {}),
    url: `${PUBLIC_BASE_URL}/s/${shop.slug}`,
    makesOffer: products.map((p) => ({
      '@type': 'Offer',
      priceCurrency: p.currency,
      price: (p.priceCents / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
      itemOffered: {
        '@type': 'Product',
        name: p.name,
        ...(p.description ? { description: p.description } : {}),
      },
    })),
  };
  // </script> can't appear inside a JSON-LD block; escape the slash defensively.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function renderShopPage(catalog: Catalog): string {
  const { shop, products } = catalog;
  const mcpUrl = `${PUBLIC_BASE_URL}/mcp`;
  const items = products.length
    ? products
        .map(
          (p) => `<li><span class="name">${esc(p.name)}</span>${
            p.description ? `<span class="desc">${esc(p.description)}</span>` : ''
          }<span class="price">${euro(p.priceCents)}</span></li>`,
        )
        .join('\n')
    : '<li class="empty">No items available right now.</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(shop.name)} — Tante Emma</title>
<script type="application/ld+json">${jsonLd(catalog)}</script>
<style>
  body{font-family:system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1.25rem;line-height:1.6;color:#1a1a1a}
  h1{margin-bottom:.2rem}
  .tagline{color:#555;margin-top:0;font-size:1.1rem}
  ul{list-style:none;padding:0;margin:2rem 0}
  li{display:flex;align-items:baseline;gap:.6rem;padding:.6rem 0;border-bottom:1px solid #eee}
  li .name{font-weight:600}
  li .desc{color:#666;font-size:.9rem}
  li .price{margin-left:auto;font-variant-numeric:tabular-nums;white-space:nowrap}
  li.empty,li.empty .name{color:#999;font-weight:400}
  footer{margin-top:2.5rem;padding-top:1.25rem;border-top:1px solid #eee;color:#444;font-size:.95rem}
  code{background:#f2f2f2;padding:.15rem .4rem;border-radius:.3rem;word-break:break-all}
</style>
</head>
<body>
<h1>${esc(shop.name)}</h1>
${shop.tagline ? `<p class="tagline">${esc(shop.tagline)}</p>` : ''}
${shop.description ? `<p>${esc(shop.description)}</p>` : ''}
<ul>
${items}
</ul>
<footer>
🤖 <strong>Order via your AI assistant.</strong> This shop is agent-ready — connect an MCP client to
<code>${esc(mcpUrl)}</code> and ask it to order for pickup.
</footer>
</body>
</html>`;
}

/** Plain-text agent guidance for one shop. */
function renderLlmsTxt(catalog: Catalog): string {
  const { shop, products } = catalog;
  const items = products.length
    ? products.map((p) => `- ${p.name} — ${euro(p.priceCents)}`).join('\n')
    : '- (no items available right now)';
  return `# ${shop.name}${shop.tagline ? `\n${shop.tagline}` : ''}

This shop is agent-ready. Browse the catalog and place pickup orders through the Tante Emma MCP server.

MCP endpoint: ${PUBLIC_BASE_URL}/mcp

Tools:
- list_shops() — discover shops
- get_catalog(shop_slug="${shop.slug}") — this shop's available items
- place_order(shop_slug="${shop.slug}", items=[{product_name, qty}], customer_name, pickup_time, note?) — place a binding pickup order; payment is at pickup

Current items:
${items}
`;
}

/** Static A2A-style agent card advertising the MCP endpoint (future-proofing flourish). */
function agentCard(): object {
  return {
    name: 'Tante Emma',
    description:
      "Agent-ready storefronts for shops that don't have a website. Browse catalogs and place pickup orders via MCP.",
    url: `${PUBLIC_BASE_URL}/`,
    provider: { organization: 'Tante Emma' },
    version: '0.1.0',
    capabilities: { streaming: true },
    skills: [
      {
        id: 'shop-catalog-and-orders',
        name: 'Browse catalogs and place pickup orders',
        description: 'List shops, fetch a shop catalog, and place binding pickup orders.',
        tags: ['commerce', 'pickup', 'catalog'],
      },
    ],
    endpoints: { mcp: `${PUBLIC_BASE_URL}/mcp` },
  };
}

/** Register the storefront, llms.txt, and agent-card routes. */
export function mountStorefront(app: Express): void {
  app.get('/s/:slug/llms.txt', async (req: Request, res: Response) => {
    const catalog = await getShopWithCatalog(String(req.params.slug ?? ''));
    if (!catalog) {
      res.status(404).type('text/plain').send('Shop not found.');
      return;
    }
    res.type('text/plain').send(renderLlmsTxt(catalog));
  });

  app.get('/s/:slug', async (req: Request, res: Response) => {
    const catalog = await getShopWithCatalog(String(req.params.slug ?? ''));
    if (!catalog) {
      res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><p>Shop not found.</p>');
      return;
    }
    res.type('html').send(renderShopPage(catalog));
  });

  app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
    res.json(agentCard());
  });
}
