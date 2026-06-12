// Catalog reads (M3). Shared by the MCP tools (mcp.ts) and the HTML storefront
// (storefront.ts), so the agent-facing and human-facing views always reflect the
// same data. Order placement / lifecycle lives in orders.ts.

import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from './db/index.js';
import type { Product, Shop } from './db/schema.js';

const { shops, products } = schema;

export type Catalog = { shop: Shop; products: Product[] };

/** Live shops only — what an agent should discover via list_shops. */
export async function listLiveShops(): Promise<Pick<Shop, 'slug' | 'name' | 'tagline'>[]> {
  return getDb()
    .select({ slug: shops.slug, name: shops.name, tagline: shops.tagline })
    .from(shops)
    .where(eq(shops.status, 'live'))
    .orderBy(asc(shops.name));
}

/** A shop (by slug) plus its available products, sorted for display. Null if no such shop. */
export async function getShopWithCatalog(slug: string): Promise<Catalog | null> {
  const db = getDb();
  const shop = (await db.select().from(shops).where(eq(shops.slug, slug)).limit(1))[0];
  if (!shop) return null;
  const available = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shop.id), eq(products.available, true)))
    .orderBy(asc(products.sort), asc(products.name));
  return { shop, products: available };
}
