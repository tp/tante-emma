// MCP server, mounted at POST /mcp in stateless mode so Render restarts and
// redeploys are invisible to connected clients (no session IDs to lose).
//
// Pattern verified against @modelcontextprotocol/sdk@1.29.0
// (examples/server/simpleStatelessStreamableHttp.ts): a fresh McpServer +
// StreamableHTTPServerTransport is created per request to avoid request-ID
// collisions, and torn down when the response closes.

import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ENV_LABEL } from './env.js';

/** Build a fresh MCP server instance with the current tool set. */
function buildServer(): McpServer {
  const server = new McpServer({
    name: 'tante-emma',
    version: '0.1.0',
  });

  // M0 dummy tool. Replaced by the real catalog/order tools in M3.
  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health probe. Returns "pong from <env>" so you can confirm the connector reached the live server.',
    },
    async () => ({
      content: [{ type: 'text', text: `pong from ${ENV_LABEL}` }],
    }),
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
