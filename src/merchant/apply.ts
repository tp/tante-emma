// Applies parsed merchant actions to the database and returns a deterministic,
// templated WhatsApp reply (PLAN.md §M2). Confirmations are never freeform LLM
// prose — we echo our own interpretation of each action, so a mis-parse can
// never produce a convincing-but-wrong confirmation.

import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { PUBLIC_BASE_URL } from '../env.js';
import { parseMerchantMessage } from './parse.js';
import type { Product, Shop } from '../db/schema.js';

const { shops, products } = schema;

// Transaction handle type, extracted from the db.transaction signature so the
// helpers below are type-safe without importing drizzle's internal generics.
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

const HELP_REPLY =
  '🤔 Couldn\'t parse that. Try: "I sell Brezn for 1.20", "remove Brezn", or "set tagline to Fresh daily".';
const NEED_NAME =
  '👋 Welcome to Tante Emma! First, what\'s your shop called? E.g. "I run a bakery called Bäckerei Demo".';

function euro(cents: number): string {
  return '€' + (cents / 100).toFixed(2);
}

function productLine(p: Product): string {
  return `✅ ${p.name} — ${euro(p.priceCents)} — ${p.available ? 'available' : 'sold out'}`;
}

/** Slugify a shop name: ASCII-fold German umlauts, then kebab-case. */
function baseSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip any remaining accents
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shop'
  );
}

/** A slug not already in use; appends -2, -3, … on collision. */
async function uniqueSlug(tx: Tx, name: string): Promise<string> {
  const base = baseSlug(name);
  const rows = await tx
    .select({ slug: shops.slug })
    .from(shops)
    .where(sql`${shops.slug} = ${base} OR ${shops.slug} LIKE ${base + '-%'}`);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Case-insensitive product lookup within a shop. */
async function findProduct(tx: Tx, shopId: number, name: string): Promise<Product | undefined> {
  const rows = await tx
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), sql`lower(${products.name}) = lower(${name})`));
  return rows[0];
}

/**
 * Parse an inbound merchant message, apply the resulting mutations in a single
 * transaction, and return the templated WhatsApp reply. Unknown senders get a
 * draft shop created the moment they name it.
 */
export async function handleMerchantMessage(phone: string, message: string): Promise<string> {
  const db = getDb();

  let shop = (await db.select().from(shops).where(eq(shops.phone, phone)).limit(1))[0] as
    | Shop
    | undefined;
  const currentProducts = shop
    ? await db.select().from(products).where(eq(products.shopId, shop.id))
    : [];

  const actions = await parseMerchantMessage(message, currentProducts);

  // Nothing actionable → graceful prompt, no rows touched.
  if (actions.every((a) => a.type === 'unparseable')) {
    return shop ? HELP_REPLY : NEED_NAME;
  }

  const lines: string[] = [];

  await db.transaction(async (tx) => {
    for (const action of actions) {
      switch (action.type) {
        case 'create_or_update_shop': {
          if (!shop) {
            if (!action.name) {
              lines.push(NEED_NAME);
              break;
            }
            const slug = await uniqueSlug(tx, action.name);
            shop = (
              await tx
                .insert(shops)
                .values({
                  slug,
                  phone,
                  name: action.name,
                  tagline: action.tagline,
                  description: action.description,
                  status: 'live',
                })
                .returning()
            )[0]!;
            lines.push(`✅ Shop "${shop.name}" created → ${PUBLIC_BASE_URL}/s/${shop.slug}`);
          } else {
            const patch: Partial<Shop> = {};
            if (action.name) patch.name = action.name;
            if (action.tagline !== undefined) patch.tagline = action.tagline;
            if (action.description !== undefined) patch.description = action.description;
            if (Object.keys(patch).length) {
              await tx.update(shops).set(patch).where(eq(shops.id, shop.id));
              Object.assign(shop, patch);
              lines.push(`✅ Shop updated: ${shop.name}`);
            }
          }
          break;
        }

        case 'upsert_product': {
          if (!shop) {
            lines.push(NEED_NAME);
            break;
          }
          if (!action.name) break;
          const existing = await findProduct(tx, shop.id, action.name);
          if (existing) {
            const patch: Partial<Product> = {};
            if (action.price_cents !== undefined) patch.priceCents = action.price_cents;
            if (action.description !== undefined) patch.description = action.description;
            if (action.available !== undefined) patch.available = action.available;
            if (Object.keys(patch).length) {
              await tx.update(products).set(patch).where(eq(products.id, existing.id));
              Object.assign(existing, patch);
            }
            lines.push(productLine(existing));
          } else {
            const inserted = (
              await tx
                .insert(products)
                .values({
                  shopId: shop.id,
                  name: action.name,
                  priceCents: action.price_cents ?? 0,
                  description: action.description,
                  available: action.available ?? true,
                })
                .returning()
            )[0]!;
            lines.push(productLine(inserted));
          }
          break;
        }

        case 'set_availability': {
          if (!shop || !action.name || action.available === undefined) break;
          const existing = await findProduct(tx, shop.id, action.name);
          if (!existing) {
            lines.push(`🤔 I don't have "${action.name}" on the menu yet.`);
            break;
          }
          await tx
            .update(products)
            .set({ available: action.available })
            .where(eq(products.id, existing.id));
          existing.available = action.available;
          lines.push(productLine(existing));
          break;
        }

        case 'remove_product': {
          if (!shop || !action.name) break;
          const existing = await findProduct(tx, shop.id, action.name);
          if (!existing) {
            lines.push(`🤔 I don't have "${action.name}" to remove.`);
            break;
          }
          await tx.delete(products).where(eq(products.id, existing.id));
          lines.push(`🗑️ Removed ${existing.name}`);
          break;
        }

        case 'unparseable':
          // Skip individual unparseables when other actions in the batch succeed.
          break;
      }
    }
  });

  return lines.length ? lines.join('\n') : HELP_REPLY;
}
