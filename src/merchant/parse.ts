// Merchant message parsing (M2, PLAN.md §4). A single Anthropic call with a
// forced tool maps an inbound WhatsApp message to a list of structured catalog
// mutations. Model: claude-haiku-4-5 — fast and cheap, ample for short
// German/English shopkeeper texts.

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Product } from '../db/schema.js';

const MODEL = 'claude-haiku-4-5';

let _client: Anthropic | undefined;
function client(): Anthropic {
  // Lazy so the app boots without ANTHROPIC_API_KEY (M0/M1). The SDK reads the
  // key from the environment; construction throws only when first used.
  if (!_client) _client = new Anthropic();
  return _client;
}

// Mutation actions the model may emit. A flat shape (a `type` discriminator plus
// optional fields) is reliable for a small model and trivial to validate.
const actionSchema = z.object({
  type: z.enum([
    'create_or_update_shop',
    'upsert_product',
    'remove_product',
    'set_availability',
    'restyle',
    'unparseable',
  ]),
  name: z.string().optional(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  price_cents: z.number().int().nonnegative().optional(),
  available: z.boolean().optional(),
  instruction: z.string().optional(),
  want_images: z.boolean().optional(),
  reason: z.string().optional(),
});
export type MerchantAction = z.infer<typeof actionSchema>;

const resultSchema = z.object({ actions: z.array(actionSchema) });

// JSON Schema for the forced tool call.
const INPUT_SCHEMA: Anthropic.Tool.InputSchema = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      description: 'Ordered list of catalog mutations implied by the message.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'create_or_update_shop',
              'upsert_product',
              'remove_product',
              'set_availability',
              'restyle',
              'unparseable',
            ],
          },
          name: {
            type: 'string',
            description: 'Shop name (create_or_update_shop) or product name (product actions).',
          },
          tagline: { type: 'string' },
          description: { type: 'string' },
          price_cents: {
            type: 'integer',
            description: 'Price in euro cents. "1,20"/"1 euro 20" → 120; "1.80"/"1 euro 80" → 180.',
          },
          available: { type: 'boolean' },
          instruction: {
            type: 'string',
            description:
              'For restyle only: the merchant\'s verbatim look-and-feel request (e.g. "make it feel Bavarian and rustic").',
          },
          want_images: {
            type: 'boolean',
            description:
              'For restyle only: true if the merchant wants generated imagery (a banner/photo/mood image or a printable menu poster), false for a CSS-only restyle.',
          },
          reason: {
            type: 'string',
            description: 'For unparseable only: why the message is not a catalog instruction.',
          },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  required: ['actions'],
};

function systemPrompt(products: Product[]): string {
  const catalog = products.length
    ? products
        .map((p) => `- ${p.name} (€${(p.priceCents / 100).toFixed(2)}, ${p.available ? 'available' : 'sold out'})`)
        .join('\n')
    : '(no products yet)';
  return [
    "You convert a shopkeeper's WhatsApp message into structured catalog updates for their shop.",
    'The merchant writes casually, in German or English. Map the message to zero or more actions.',
    '',
    'Action types:',
    '- create_or_update_shop: set the shop name/tagline/description (e.g. "I run a bakery called Bäckerei Demo").',
    '- upsert_product: add or update a product. Give name, plus price_cents and/or available and/or description when stated.',
    '- remove_product: delete a product by name.',
    '- set_availability: mark a product available or sold out by name.',
    '- restyle: the merchant wants to change the look/design/style/colours/vibe of their storefront',
    '  (e.g. "make it feel Bavarian and rustic", "give it a modern dark theme", "add a header photo").',
    '  Put their request verbatim in `instruction`. Set `want_images` true if they mention any imagery',
    '  (banner, photo, picture, header image, mood image, printable menu/poster); otherwise false.',
    '- unparseable: the message is not a catalog instruction. Set reason. Prefer this over guessing.',
    '',
    'Rules:',
    '- Prices are euros; normalise to integer cents. "1,20" and "1 euro 20" → 120. "1.80"/"1 euro 80" → 180.',
    '- Match products case-insensitively by name against the current catalog below.',
    '- If a message both names the shop and lists products, emit one action per fact.',
    '- If the message is ambiguous, emit a single unparseable action rather than guessing.',
    '',
    'Current catalog for this shop:',
    catalog,
  ].join('\n');
}

/** Parse an inbound merchant message into ordered, validated actions. */
export async function parseMerchantMessage(
  message: string,
  products: Product[],
): Promise<MerchantAction[]> {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt(products),
    tools: [
      {
        name: 'apply_merchant_update',
        description: 'Record the catalog mutations implied by the merchant message.',
        input_schema: INPUT_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'apply_merchant_update' },
    messages: [{ role: 'user', content: message }],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') {
    return [{ type: 'unparseable', reason: 'no tool output' }];
  }
  const parsed = resultSchema.safeParse(block.input);
  if (!parsed.success) {
    return [{ type: 'unparseable', reason: 'schema validation failed' }];
  }
  return parsed.data.actions;
}
