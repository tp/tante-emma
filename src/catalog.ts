// Catalog reads and order placement (M3). Shared by the MCP tools (mcp.ts) and
// the HTML storefront (storefront.ts), so the agent-facing and human-facing
// views always reflect the same data.

import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from './db/index.js';
import { sendWhatsApp } from './whatsapp.js';
import { euro } from './format.js';
import type { OrderItem, Product, Shop } from './db/schema.js';

const { shops, products, orders } = schema;

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

export type OrderRequestItem = { product_name?: string; product_id?: number; qty: number };
export type PlaceOrderInput = {
  shop_slug: string;
  items: OrderRequestItem[];
  customer_name: string;
  pickup_time: string;
  note?: string;
};
export type PlaceOrderResult =
  | { ok: true; orderId: number; confirmation: string }
  | { ok: false; error: string };

/**
 * Validate an order against the live catalog, write it, and notify the merchant
 * by WhatsApp. Returns the buyer-facing confirmation text (for the agent to
 * relay) or a clear error. Merchant notification is best-effort — a Twilio
 * failure does not roll back the order.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const db = getDb();

  const shop = (await db.select().from(shops).where(eq(shops.slug, input.shop_slug)).limit(1))[0];
  if (!shop) return { ok: false, error: `No shop found with slug "${input.shop_slug}".` };

  const menu = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shop.id), eq(products.available, true)));

  // Resolve each requested item against the available menu.
  const lines: OrderItem[] = [];
  for (const item of input.items) {
    const match = menu.find(
      (p) =>
        (item.product_id !== undefined && p.id === item.product_id) ||
        (item.product_name !== undefined &&
          p.name.toLowerCase() === item.product_name.trim().toLowerCase()),
    );
    if (!match) {
      const label = item.product_name ?? `#${item.product_id}`;
      return { ok: false, error: `"${label}" is not on the menu or is sold out.` };
    }
    const qty = Math.max(1, Math.floor(item.qty));
    lines.push({ productId: match.id, name: match.name, qty, priceCents: match.priceCents });
  }
  if (lines.length === 0) return { ok: false, error: 'The order has no items.' };

  const totalCents = lines.reduce((sum, l) => sum + l.qty * l.priceCents, 0);

  const order = (
    await db
      .insert(orders)
      .values({
        shopId: shop.id,
        items: lines,
        customerName: input.customer_name,
        pickupTime: input.pickup_time,
        note: input.note,
        totalCents,
        status: 'placed',
      })
      .returning()
  )[0]!;

  const itemLines = lines
    .map((l) => `${l.qty}× ${l.name} — ${euro(l.qty * l.priceCents)}`)
    .join('\n');

  // Notify the merchant. Best-effort — never fail the order on a Twilio hiccup.
  const merchantMsg = [
    `🧾 New order #${order.id} · ${shop.name}`,
    itemLines,
    `Total: ${euro(totalCents)}`,
    `👤 ${input.customer_name} · Pickup ${input.pickup_time}`,
    input.note ? `💬 ${input.note}` : null,
    '💶 Pay at pickup.',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    await sendWhatsApp(shop.phone, merchantMsg);
  } catch (err) {
    console.error('[order] merchant WhatsApp notify failed:', err);
  }

  const confirmation = [
    `✅ Order #${order.id} placed at ${shop.name}.`,
    itemLines,
    `Total ${euro(totalCents)} · pickup ${input.pickup_time} for ${input.customer_name} · pay at pickup.`,
  ].join('\n');

  return { ok: true, orderId: order.id, confirmation };
}
