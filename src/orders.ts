// Order lifecycle (M3.5): placement → payment → ready-for-pickup. Kept separate
// from catalog.ts (which holds read queries) because placement now spans the DB,
// the buyer-facing payment gate, and the merchant WhatsApp notification.
//
// Lifecycle: pending_payment → paid → ready.
// `markPaid` is the single "payment confirmed" seam — a real payment provider
// would call it and nothing else here changes.

import { and, eq } from 'drizzle-orm';
import { getDb, schema } from './db/index.js';
import { sendWhatsApp } from './whatsapp.js';
import { euro } from './format.js';
import { PUBLIC_BASE_URL } from './env.js';
import type { Order, OrderItem, Shop } from './db/schema.js';

const { shops, products, orders } = schema;

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

function itemLinesOf(items: OrderItem[]): string {
  return items.map((l) => `${l.qty}× ${l.name} — ${euro(l.qty * l.priceCents)}`).join('\n');
}

/**
 * Validate an order against the live catalog and write it in `pending_payment`.
 * The merchant is NOT notified here — that happens in markPaid, once the buyer
 * pays. Returns buyer-facing confirmation text containing the order-page link.
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
        status: 'pending_payment',
      })
      .returning()
  )[0]!;

  const confirmation = [
    `✅ Order #${order.id} created at ${shop.name}.`,
    itemLinesOf(lines),
    `Total ${euro(totalCents)} · pickup ${input.pickup_time} for ${input.customer_name}.`,
    `💳 Open this link to pay and confirm: ${PUBLIC_BASE_URL}/o/${order.id}`,
    '(The shop is notified only after payment.)',
  ].join('\n');

  return { ok: true, orderId: order.id, confirmation };
}

/**
 * Mark an order paid and notify the merchant. Idempotent: if already paid/ready,
 * returns the order without re-notifying. This is the single payment-confirmed
 * entry point. Merchant notification is best-effort.
 */
export async function markPaid(orderId: number): Promise<Order | null> {
  const db = getDb();

  const order = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
  if (!order) return null;
  if (order.status !== 'pending_payment') return order; // already paid/ready — don't re-notify

  const paid = (
    await db.update(orders).set({ status: 'paid' }).where(eq(orders.id, orderId)).returning()
  )[0]!;

  const shop = (await db.select().from(shops).where(eq(shops.id, paid.shopId)).limit(1))[0];
  if (shop) {
    const merchantMsg = [
      `🧾 New paid order #${paid.id} · ${shop.name}`,
      itemLinesOf(paid.items),
      `Total: ${euro(paid.totalCents)}`,
      `👤 ${paid.customerName} · Pickup ${paid.pickupTime ?? '—'}`,
      paid.note ? `💬 ${paid.note}` : null,
      `↩️ Reply "${paid.id}" to mark this order ready for pickup.`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await sendWhatsApp(shop.phone, merchantMsg);
    } catch (err) {
      console.error('[order] merchant WhatsApp notify failed:', err);
    }
  }

  return paid;
}

/**
 * Mark a paid order ready for pickup. Scoped to the merchant's own shop (tenant
 * isolation) and requires the order to be `paid`. Returns the row, or null if no
 * such paid order exists for this shop.
 */
export async function markReady(shopId: number, orderNumber: number): Promise<Order | null> {
  const updated = await getDb()
    .update(orders)
    .set({ status: 'ready' })
    .where(
      and(eq(orders.id, orderNumber), eq(orders.shopId, shopId), eq(orders.status, 'paid')),
    )
    .returning();
  return updated[0] ?? null;
}

/** Fetch a single order for the order page. */
export async function getOrderForPage(id: number): Promise<Order | null> {
  if (!Number.isInteger(id)) return null;
  const row = (await getDb().select().from(orders).where(eq(orders.id, id)).limit(1))[0];
  return row ?? null;
}
