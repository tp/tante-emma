// Restyle orchestration — composes the creative pieces into a complete look.
// `buildLook` is pure (LLM + image calls, no DB): apply.ts owns persistence and the
// templated WhatsApp reply. `refreshLiveMenuImage` keeps the printable menu poster
// in sync after catalog edits, reusing the shop's saved moodPrompt so the mood holds.

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { PUBLIC_BASE_URL } from '../env.js';
import { sendWhatsApp } from '../whatsapp.js';
import { generateDesign } from './generate.js';
import { generateBanner, generateMenuPoster } from './image.js';
import type { Product, Shop, ShopConfig } from '../db/schema.js';

const { shops, products } = schema;

/**
 * Generate a complete new look from a merchant's instruction: a sanitized custom
 * stylesheet + a saved moodPrompt, and — when `wantImages` — a mood banner and a
 * printable menu poster, both driven by that same moodPrompt. No DB writes.
 */
export async function buildLook(
  shop: Shop,
  catalog: Product[],
  instruction: string,
  wantImages: boolean,
): Promise<ShopConfig> {
  const design = await generateDesign(instruction, shop, catalog);
  const config: ShopConfig = { css: design.css, moodPrompt: design.moodPrompt };
  if (wantImages) {
    const [headerImage, menuImage] = await Promise.all([
      generateBanner(design.moodPrompt),
      generateMenuPoster(design.moodPrompt, shop, catalog),
    ]);
    config.headerImage = headerImage;
    config.menuImage = menuImage;
  }
  return config;
}

/**
 * Generate a restyle off the webhook path and push the preview via outbound
 * WhatsApp — image generation is far too slow to ride Twilio's synchronous reply
 * window. Stores the result as a draft (token-gated) and texts the merchant a
 * preview link plus the generated image(s) inline. Fire-and-forget; never throws.
 */
export async function runRestyleAndNotify(
  shopId: number,
  instruction: string,
  wantImages: boolean,
  phone: string,
): Promise<void> {
  const db = getDb();
  const shop = (await db.select().from(shops).where(eq(shops.id, shopId)).limit(1))[0] as
    | Shop
    | undefined;
  if (!shop) return;
  try {
    const draft = await buildLook(shop, await liveCatalog(shopId), instruction, wantImages);
    const token = randomUUID();
    await db.update(shops).set({ draftConfig: draft, previewToken: token }).where(eq(shops.id, shopId));

    const base = `${PUBLIC_BASE_URL}/s/${shop.slug}`;
    const media: string[] = [];
    if (draft.headerImage) media.push(`${base}/header?preview=${token}`);
    if (draft.menuImage) media.push(`${base}/menu.png?preview=${token}`);
    const body = `👀 Here's your new look${media.length ? ' (image above)' : ''}:\n${base}?preview=${token}\nReply "ok" to publish, or keep describing changes.`;
    await sendWhatsApp(phone, body, media);
  } catch (err) {
    console.error('[restyle] generation failed:', err);
    await sendWhatsApp(
      phone,
      "⚠️ Couldn't generate the new look just now — please text your idea again in a moment.",
    ).catch((e) => console.error('[restyle] error notice failed:', e));
  }
}

/** Available products for a shop, ordered to match the storefront. */
async function liveCatalog(shopId: number): Promise<Product[]> {
  return getDb()
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.available, true)))
    .orderBy(asc(products.sort), asc(products.name));
}

/**
 * Regenerate the live printable menu poster from the saved moodPrompt and the
 * current menu, so it reflects catalog edits. No-op unless the shop already has an
 * image-based look. Intended to be fire-and-forget (callers catch + log).
 */
export async function refreshLiveMenuImage(shopId: number): Promise<void> {
  const db = getDb();
  const shop = (await db.select().from(shops).where(eq(shops.id, shopId)).limit(1))[0] as
    | Shop
    | undefined;
  if (!shop || !shop.config.moodPrompt || !shop.config.menuImage) return;
  const menuImage = await generateMenuPoster(shop.config.moodPrompt, shop, await liveCatalog(shopId));
  await db.update(shops).set({ config: { ...shop.config, menuImage } }).where(eq(shops.id, shopId));
}
