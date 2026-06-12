// Image generation for the restyle flow — OpenAI gpt-image-2 (the April 2026
// flagship; DALL·E 2/3 are deprecated). Two assets per restyle, both driven by the
// saved moodPrompt so the web view and the printable variant feel like one shop:
//   - a wide decorative banner shown atop the web storefront (.hero), and
//   - a portrait, printable full-menu poster (the "image variant" toggle) with the
//     shop name + items + prices rendered into the art (gpt-image-2 does in-image
//     text well, ~99% character accuracy).
//
// Called via fetch with no SDK, matching the project's outbound style (whatsapp.ts).
// The key is read lazily (requireEnv at call time) so the app still boots without it.

import { requireEnv } from '../env.js';
import type { Product, Shop, ShopImage } from '../db/schema.js';

const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const MODEL = 'gpt-image-2';

type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';

/** Generate one image from a prompt. Returns inline base64 (PNG) ready to store. */
async function generateImage(prompt: string, size: ImageSize): Promise<ShopImage> {
  const key = requireEnv('OPENAI_API_KEY');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size,
      n: 1,
      quality: 'medium', // balance look vs. latency/cost for a one-shot restyle
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI image generation failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI image generation returned no image data');
  return { dataBase64: b64, mime: 'image/png' };
}

/** A wide, decorative mood banner — no text (the page renders the name in HTML). */
export function generateBanner(moodPrompt: string): Promise<ShopImage> {
  const prompt = [
    moodPrompt,
    'Wide decorative header banner / hero image for a shop website.',
    'Atmospheric and on-brand. No text, no words, no lettering, no logos — purely the scene.',
  ].join(' ');
  return generateImage(prompt, '1536x1024');
}

/** A portrait, printable full-menu poster with the shop name, items, and prices. */
export function generateMenuPoster(
  moodPrompt: string,
  shop: Shop,
  products: Product[],
): Promise<ShopImage> {
  const items = products.length
    ? products.map((p) => `${p.name} — €${(p.priceCents / 100).toFixed(2)}`).join('\n')
    : 'No items available right now.';
  const prompt = [
    `A printable menu poster for a shop called "${shop.name}".`,
    shop.tagline ? `Tagline: "${shop.tagline}".` : '',
    `Visual mood: ${moodPrompt}`,
    'Design it as a single elegant printed menu / poster: the shop name as a large title at the top,',
    'then the items with their prices laid out clearly and legibly as a menu. Render this exact text,',
    'spelled correctly, do not invent extra items:',
    '',
    items,
  ]
    .filter((l) => l !== '')
    .join('\n');
  return generateImage(prompt, '1024x1536');
}
