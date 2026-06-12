// Express entrypoint. One process serves everything: the MCP endpoint, the
// storefront (M3), the WhatsApp webhook (M1), and health checks.

import express from 'express';
import { PORT, PUBLIC_BASE_URL, ENV_LABEL } from './env.js';
import { mountMcp } from './mcp.js';
import { mountWhatsApp } from './whatsapp.js';

const app = express();

// JSON for the MCP endpoint; urlencoded for the (future) Twilio form webhook.
// Both only act on matching Content-Type, so they coexist safely.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Render health check / keep-alive target. Must not depend on the database.
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', env: ENV_LABEL, time: new Date().toISOString() });
});

// MCP streamable HTTP endpoint (stateless) at POST /mcp.
mountMcp(app);

// WhatsApp inbound webhook + outbound helper (M1).
mountWhatsApp(app);

// Landing: the thesis in one paragraph + where agents connect.
app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tante Emma</title>
<style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.25rem;line-height:1.6;color:#1a1a1a}code{background:#f2f2f2;padding:.15rem .4rem;border-radius:.3rem}</style>
</head>
<body>
<h1>Tante Emma</h1>
<p>Everyone is making Shopify stores agent-ready. We make the shop that <em>doesn't have a website</em>
agent-ready &mdash; and the admin panel is a text message. A merchant texts WhatsApp; a live storefront
and an MCP server appear; any AI assistant can browse the catalog and place a pickup order.</p>
<p>Agents connect here: <code>${PUBLIC_BASE_URL}/mcp</code></p>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`tante-emma listening on :${PORT} (${ENV_LABEL})`);
  console.log(`MCP endpoint: ${PUBLIC_BASE_URL}/mcp`);
});
