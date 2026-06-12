// MCP server, mounted at POST /mcp in stateless mode so Render restarts and
// redeploys are invisible to connected clients (no session IDs to lose).
//
// Pattern verified against @modelcontextprotocol/sdk@1.29.0
// (examples/server/simpleStatelessStreamableHttp.ts): a fresh McpServer +
// StreamableHTTPServerTransport is created per request to avoid request-ID
// collisions, and torn down when the response closes.

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PUBLIC_BASE_URL } from './env.js';
import { euro } from './format.js';
import { getShopWithCatalog, listLiveShops } from './catalog.js';
import { placeOrder } from './orders.js';

/** Build a fresh MCP server instance with the current tool set. */
function buildServer(): McpServer {
  const server = new McpServer({
    name: 'tante-emma',
    version: '0.1.0',
  });

  // Discover shops. Tool descriptions are product copy for agents — keep them
  // precise so the model calls the right tool with the right arguments.
  server.registerTool(
    'list_shops',
    {
      title: 'List shops',
      description:
        'List the live shops on Tante Emma (name, slug, tagline). Call this first to discover which shops exist before fetching a catalog or placing an order.',
    },
    async () => {
      const shops = await listLiveShops();
      if (shops.length === 0) {
        return { content: [{ type: 'text', text: 'No live shops yet.' }] };
      }
      const text = shops
        .map((s) => `- ${s.name} (slug: ${s.slug})${s.tagline ? ` — ${s.tagline}` : ''}`)
        .join('\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // Fetch one shop's available catalog.
  server.registerTool(
    'get_catalog',
    {
      title: 'Get catalog',
      description:
        "Get a shop's details and available products with prices. Pass the shop_slug from list_shops. Use this to see what can be ordered and the exact product names.",
      inputSchema: {
        shop_slug: z.string().describe('The shop slug, e.g. "baeckerei-demo".'),
      },
    },
    async ({ shop_slug }) => {
      const catalog = await getShopWithCatalog(shop_slug);
      if (!catalog) {
        return {
          content: [{ type: 'text', text: `No shop found with slug "${shop_slug}".` }],
          isError: true,
        };
      }
      const { shop, products } = catalog;
      const header = [shop.name, shop.tagline, shop.description].filter(Boolean).join(' — ');
      const items = products.length
        ? products.map((p) => `- ${p.name} — ${euro(p.priceCents)}`).join('\n')
        : '(no items available right now)';
      const text = [
        header,
        `Storefront: ${PUBLIC_BASE_URL}/s/${shop.slug}`,
        '',
        'Available items:',
        items,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    },
  );

  // Place a binding pickup order.
  server.registerTool(
    'place_order',
    {
      title: 'Place order',
      description:
        'Creates a pickup order in a pending state and returns a link the buyer must open to pay. The order is confirmed and sent to the shop ONLY after payment — relay the returned link and tell the buyer to open it to complete the order. ALWAYS confirm the items, pickup time, and customer name with the user before calling. Prices are in EUR. Item names must match the catalog (call get_catalog first if unsure).',
      inputSchema: {
        shop_slug: z.string().describe('The shop slug from list_shops / get_catalog.'),
        items: z
          .array(
            z.object({
              product_name: z
                .string()
                .optional()
                .describe('Product name exactly as shown in the catalog.'),
              product_id: z.number().int().optional().describe('Product id (alternative to name).'),
              qty: z.number().int().min(1).describe('Quantity, at least 1.'),
            }),
          )
          .min(1)
          .describe('One entry per distinct product.'),
        customer_name: z.string().describe("The customer's name for the order."),
        pickup_time: z.string().describe('When the customer will collect, e.g. "16:00".'),
        note: z.string().optional().describe('Optional note for the merchant.'),
      },
    },
    async (args) => {
      const result = await placeOrder(args);
      if (!result.ok) {
        return { content: [{ type: 'text', text: result.error }], isError: true };
      }
      return { content: [{ type: 'text', text: result.confirmation }] };
    },
  );

  return server;
}

const methodNotAllowed = {
  jsonrpc: '2.0' as const,
  error: { code: -32000, message: 'Method not allowed.' },
  id: null,
};

/** Register the MCP routes on the given Express app. */
export function mountMcp(app: Express): void {
  // Minimal CORS so browser-based MCP clients (e.g. the MCP Inspector) work.
  // claude.ai's connector calls server-side, so this is belt-and-braces.
  app.use('/mcp', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version');
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = buildServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no server-initiated streams or sessions to tear down.
  app.get('/mcp', (_req, res) => {
    res.status(405).json(methodNotAllowed);
  });
  app.delete('/mcp', (_req, res) => {
    res.status(405).json(methodNotAllowed);
  });
}
