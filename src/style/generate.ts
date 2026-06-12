// Storefront restyle — the creative half of the "vibe restyle" flow. A single
// Anthropic call turns a merchant's freeform instruction ("make it feel Bavarian
// and rustic") into a real custom stylesheet *plus* a saved visual mood prompt
// that drives the generated images (header banner + printable menu poster).
//
// This deliberately reverses PLAN §M6's "the LLM never emits raw CSS": the CSS is
// layered *over* the base theme (ui.ts) so the base stays a safe floor, and it is
// run through sanitizeCss() to neutralise element-breakout XSS before it reaches a
// page. A stronger model than the cheap parse (claude-sonnet-4-6) — a full redesign
// is well beyond Haiku.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Product, Shop } from '../db/schema.js';

// A full storefront redesign is a real coding task — use the strongest model.
// The restyle path is async (off the webhook), so the extra latency is free.
const MODEL = 'claude-opus-4-8';

let _client: Anthropic | undefined;
function client(): Anthropic {
  // Lazy, like merchant/parse.ts — the app boots without ANTHROPIC_API_KEY.
  if (!_client) _client = new Anthropic();
  return _client;
}

const designSchema = z.object({
  css: z.string(),
  moodPrompt: z.string(),
});
export type Design = z.infer<typeof designSchema>;

const DESIGN_TOOL_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    css: {
      type: 'string',
      description:
        'A complete custom stylesheet, appended AFTER the base theme. Override the base; do not restate it. No <style> tags, no @import. Target the stable class hooks listed in the system prompt.',
    },
    moodPrompt: {
      type: 'string',
      description:
        "A vivid 1-2 sentence visual scene/mood description for an image generator (e.g. 'a warm rustic Bavarian bakery at dawn, dark wood and wheat, cream and forest-green palette, soft morning light'). Drives the header banner and the printable menu poster.",
    },
  },
  required: ['css', 'moodPrompt'],
};

// The stable styling "API": the class hooks the base theme (ui.ts) exposes. Kept
// here as product copy for the model — change in lockstep with ui.ts.
const STYLE_HOOKS = `Stable class hooks you may target (base theme already styles these — you override):
- :root custom properties: --paper --card --ink --muted --line --green --green-dk --amber --amber-ink --amber-soft --serif --sans
- body, a, h1
- .awning            (the thin striped bar at the very top)
- header.site, header.site .wordmark, header.site .kicker
- .hero              (full-bleed mood banner atop the page; the server sets its background-image — style its height/overlay/rounding, do NOT set background-image)
- .tagline, .muted
- .card
- .menu, .menu li, .menu .name, .menu .desc, .menu .dots, .menu .price (also bare .price)
- .callout           (the "order via AI assistant" box)
- footer.site`;

function systemPrompt(): string {
  return [
    'You are a web designer restyling a small shop storefront. Given the shopkeeper\'s',
    'instruction, produce ONE cohesive custom stylesheet and a matching visual mood prompt.',
    '',
    'The stylesheet is appended AFTER a base theme, so you only need to write the',
    'overrides that realise the requested vibe — colours (prefer overriding the :root',
    'custom properties), typography, spacing, the .hero banner, the .menu list, borders,',
    'backgrounds. Keep it readable and accessible (sufficient contrast, legible sizes).',
    'Output raw CSS only — no <style> tags, no markdown fences, no @import.',
    '',
    STYLE_HOOKS,
    '',
    'Also return a moodPrompt: a vivid visual scene describing the shop\'s atmosphere,',
    'reused to generate the page\'s banner image and a printable menu poster. Match the',
    'palette and feel of your CSS so the web view and the image variant feel like one shop.',
  ].join('\n');
}

function userPrompt(instruction: string, shop: Shop, products: Product[]): string {
  const menu = products.length
    ? products.map((p) => `- ${p.name} (€${(p.priceCents / 100).toFixed(2)})`).join('\n')
    : '(no products yet)';
  return [
    `Shop name: ${shop.name}`,
    shop.tagline ? `Tagline: ${shop.tagline}` : '',
    '',
    'Current menu:',
    menu,
    '',
    `Restyle instruction: ${instruction}`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** Generate a custom stylesheet (already sanitized) + a saved mood prompt. */
export async function generateDesign(
  instruction: string,
  shop: Shop,
  products: Product[],
): Promise<Design> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt(),
    tools: [
      {
        name: 'emit_design',
        description: 'Record the custom stylesheet and visual mood prompt for the storefront.',
        input_schema: DESIGN_TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_design' },
    messages: [{ role: 'user', content: userPrompt(instruction, shop, products) }],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    throw new Error('design generation returned no tool output');
  }
  const parsed = designSchema.safeParse(block.input);
  if (!parsed.success) {
    throw new Error('design generation failed schema validation');
  }
  return { css: sanitizeCss(parsed.data.css), moodPrompt: parsed.data.moodPrompt.trim() };
}

/**
 * Neutralise the one real danger of injecting model-authored CSS into a page: an
 * element breakout. Inside a <style> block the only way out is the literal
 * `</style` (or `</script`) sequence, so we defang any `</` — CSS never needs it.
 * Also strip @import, which could pull in an external stylesheet. url() is left
 * intact: it's the shop's own page, and the base theme remains the safe floor.
 */
export function sanitizeCss(raw: string): string {
  return raw
    .replace(/<\/(style|script)/gi, '<\\/$1') // defang element-close breakouts
    .replace(/@import\b[^;]*;?/gi, '') // no external stylesheet pulls
    .trim();
}
