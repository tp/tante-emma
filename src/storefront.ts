// The storefront's human + agent faces (M3): server-rendered HTML at /s/:slug
// with schema.org JSON-LD, a plain-text llms.txt per shop, and a static A2A-style
// agent card. No template engine, no client JS — plain and fast on purpose.

import type { Express, Request, Response } from 'express';
import { PUBLIC_BASE_URL } from './env.js';
import { euro } from './format.js';
import { layout, esc } from './ui.js';
import { sanitizeCss } from './style/generate.js';
import { getShopWithCatalog, type Catalog } from './catalog.js';
import type { Shop, ShopConfig } from './db/schema.js';

/**
 * Pick the look to render. A valid `?preview=` token (matching the shop's
 * previewToken) shows the pending draft; anything else shows the live config — so
 * customers can't stumble into an unpublished restyle.
 */
function effectiveConfig(shop: Shop, previewToken?: string): { config: ShopConfig; isPreview: boolean } {
  const isPreview = !!previewToken && !!shop.previewToken && previewToken === shop.previewToken;
  return { config: isPreview ? shop.draftConfig : shop.config, isPreview };
}

/** Build a `?key=value&…` suffix from defined params (omits empties). */
function query(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return pairs.length ? '?' + pairs.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&') : '';
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

export function renderShopPage(catalog: Catalog, previewToken?: string): string {
  const { shop, products } = catalog;
  const { config, isPreview } = effectiveConfig(shop, previewToken);
  const previewQuery = isPreview ? { preview: previewToken } : {};
  const mcpUrl = `${PUBLIC_BASE_URL}/mcp`;
  const items = products.length
    ? products
        .map(
          (p) =>
            `<li><span class="name">${esc(p.name)}</span>${
              p.description ? `<span class="desc">${esc(p.description)}</span>` : ''
            }<span class="dots"></span><span class="price">${euro(p.priceCents)}</span></li>`,
        )
        .join('\n')
    : '<li class="empty">No items available right now.</li>';

  // Server-controlled image URL so the correct draft-vs-live banner is served.
  const heroImageUrl = config.headerImage
    ? `/s/${shop.slug}/header${query(previewQuery)}`
    : undefined;
  const menuImageLink = config.menuImage
    ? `<p class="muted"><a href="${query({ ...previewQuery, view: 'image' })}">🖼 View as printable menu</a></p>`
    : '';

  const body = `
${isPreview ? '<div class="callout">👀 <strong>Preview.</strong> This is your pending look — reply <code>ok</code> in WhatsApp to publish it, or keep describing changes.</div>' : ''}
<h1>${esc(shop.name)}</h1>
${shop.tagline ? `<p class="tagline">${esc(shop.tagline)}</p>` : ''}
${shop.description ? `<p class="muted">${esc(shop.description)}</p>` : ''}
<ul class="menu">
${items}
</ul>
${menuImageLink}
<div class="callout">
🤖 <strong>Order via your AI assistant.</strong> This shop is agent-ready — point an MCP client at
<code>${esc(mcpUrl)}</code> and ask it to place a pickup order.
</div>`;

  return layout({
    title: `${shop.name} — Tante Emma`,
    body,
    head: `<script type="application/ld+json">${jsonLd(catalog)}</script>`,
    customStyle: config.css ? sanitizeCss(config.css) : undefined,
    heroImageUrl,
  });
}

/** The "image variant": the printable full-menu poster, with a print + back toggle. */
export function renderMenuImagePage(catalog: Catalog, previewToken?: string): string {
  const { shop } = catalog;
  const { config, isPreview } = effectiveConfig(shop, previewToken);
  const previewQuery = isPreview ? { preview: previewToken } : {};
  if (!config.menuImage) {
    return layout({
      title: `${shop.name} — Tante Emma`,
      body: `<div class="card"><h1>${esc(shop.name)}</h1><p class="muted">No printable menu yet.</p><p><a href="${query(previewQuery)}">← Back to the shop</a></p></div>`,
    });
  }
  const imgUrl = `/s/${shop.slug}/menu.png${query(previewQuery)}`;
  const body = `
<p class="noprint" style="display:flex;gap:.8rem;justify-content:center;margin:0 0 1.2rem">
  <a class="btn" href="${query(previewQuery)}">← Web view</a>
  <button class="btn" onclick="window.print()">🖨 Print</button>
</p>
<img src="${imgUrl}" alt="${esc(shop.name)} menu" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid var(--line)">`;
  return layout({
    title: `${shop.name} — printable menu`,
    body,
    wide: true,
    // Print just the poster: drop the site chrome and the on-screen buttons.
    customStyle:
      '@media print{.awning,header.site,footer.site,.noprint{display:none!important}main{margin:0;max-width:100%;padding:0}img{border:0!important;border-radius:0!important}}',
  });
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
- place_order(shop_slug="${shop.slug}", items=[{product_name, qty}], customer_name, pickup_time, note?) — creates a pickup order and returns a link the buyer opens to pay; the shop is notified only after payment

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

  // Serve a generated image (header banner or menu poster), preview-aware.
  const serveImage = (key: 'headerImage' | 'menuImage') =>
    async (req: Request, res: Response): Promise<void> => {
      const catalog = await getShopWithCatalog(String(req.params.slug ?? ''));
      if (!catalog) {
        res.status(404).type('text/plain').send('Not found.');
        return;
      }
      const preview = req.query.preview ? String(req.query.preview) : undefined;
      const { config } = effectiveConfig(catalog.shop, preview);
      const image = config[key];
      if (!image) {
        res.status(404).type('text/plain').send('No image.');
        return;
      }
      // Drafts and just-published looks change under a stable URL — don't cache.
      res.type(image.mime).set('Cache-Control', 'no-store').send(Buffer.from(image.dataBase64, 'base64'));
    };

  app.get('/s/:slug/header', serveImage('headerImage'));
  app.get('/s/:slug/menu.png', serveImage('menuImage'));

  app.get('/s/:slug', async (req: Request, res: Response) => {
    const catalog = await getShopWithCatalog(String(req.params.slug ?? ''));
    if (!catalog) {
      res
        .status(404)
        .type('html')
        .send(
          layout({
            title: 'Shop not found — Tante Emma',
            body: '<div class="card"><h1>Shop not found</h1><p class="muted">There\'s no shop at this address yet.</p></div>',
          }),
        );
      return;
    }
    const preview = req.query.preview ? String(req.query.preview) : undefined;
    const html =
      String(req.query.view ?? '') === 'image'
        ? renderMenuImagePage(catalog, preview)
        : renderShopPage(catalog, preview);
    res.type('html').send(html);
  });

  app.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
    res.json(agentCard());
  });
}
