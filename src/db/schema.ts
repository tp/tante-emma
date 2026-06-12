// Drizzle schema — the complete data model from PLAN.md §2. Resist additions.

import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  boolean,
  jsonb,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const shopStatus = pgEnum('shop_status', ['draft', 'live']);

/** Order lifecycle. Plain text (not a pg enum) so the set can evolve without
 * Postgres enum-alteration pain. `markPaid` is the single payment-confirmed seam. */
export type OrderStatus = 'pending_payment' | 'paid' | 'ready';

/** Per-shop look & feel, set by the M6 "vibe restyle" flow. Whitelist-validated. */
export type ShopConfig = {
  accentColor?: string;
  font?: string;
  heroBlurb?: string;
};

export const shops = pgTable('shops', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  // E.164 WhatsApp number of the owning merchant — the multi-tenancy key.
  phone: text('phone').notNull().unique(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  description: text('description'),
  status: shopStatus('status').notNull().default('draft'),
  config: jsonb('config').$type<ShopConfig>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  shopId: integer('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('EUR'),
  available: boolean('available').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Snapshot of an ordered line item — denormalised so orders survive product edits. */
export type OrderItem = {
  productId: number;
  name: string;
  qty: number;
  priceCents: number;
};

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  shopId: integer('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  items: jsonb('items').$type<OrderItem[]>().notNull(),
  customerName: text('customer_name').notNull(),
  pickupTime: text('pickup_time'),
  note: text('note'),
  totalCents: integer('total_cents').notNull(),
  status: text('status').$type<OrderStatus>().notNull().default('pending_payment'),
  paymentLinkUrl: text('payment_link_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // DB-level validation in place of a pg enum — easy to evolve (alter one
  // constraint) without the enum ALTER-TYPE transaction pain.
  check('orders_status_check', sql`${t.status} in ('pending_payment', 'paid', 'ready')`),
]);

export type Shop = typeof shops.$inferSelect;
export type NewShop = typeof shops.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
