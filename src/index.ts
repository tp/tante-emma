// Express entrypoint. One process serves everything: the MCP endpoint, the
// storefront (M3), the WhatsApp webhook (M1), and health checks.

import express from 'express';
import { PORT, PUBLIC_BASE_URL, ENV_LABEL } from './env.js';
import { mountMcp } from './mcp.js';
import { mountWhatsApp } from './whatsapp.js';
import { mountStorefront } from './storefront.js';
import { mountOrderPage } from './order_page.js';
import { layout } from './ui.js';
import { runMigrations } from './db/migrate.js';

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

// Storefront HTML, per-shop llms.txt, and the static agent card (M3).
mountStorefront(app);

// Buyer-facing order page: pay + live status polling (M3.5).
mountOrderPage(app);

// Landing: the thesis in one paragraph + where agents connect.
app.get('/', (_req, res) => {
  res.type('html').send(
    layout({
      title: 'Tante Emma — the corner shop, agent-ready',
      body: `
<h1>The shop that doesn't have a website, made agent-ready.</h1>
<p class="tagline">And the admin panel is a text message.</p>
<p class="muted">A merchant texts WhatsApp; a live storefront and an MCP server appear. Any AI
assistant can browse the catalog and place a pickup order &mdash; and the buyer pays from a link.</p>
<div class="callout">🔌 <strong>Agents connect here:</strong> <code>${PUBLIC_BASE_URL}/mcp</code></div>`,
    }),
  );
});

app.listen(PORT, () => {
  console.log(`tante-emma listening on :${PORT} (${ENV_LABEL})`);
  console.log(`MCP endpoint: ${PUBLIC_BASE_URL}/mcp`);

  // Apply pending DB migrations after the server is already accepting requests.
  // Fire-and-forget: a failure here must not crash the process — /healthz and the
  // MCP endpoint keep serving so the claude.ai connector is never taken down by a
  // database problem. The merchant brain / storefront simply won't work until the
  // DB is reachable, which the logs will make obvious.
  runMigrations()
    .then(() => console.log('[db] migrations applied'))
    .catch((err) => console.error('[db] migration failed (continuing):', err));
});
