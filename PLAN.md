# Tante Emma — Hackathon Build Plan

**One-liner:** Everyone is making Shopify stores agent-ready. We make the shop that doesn't have a website agent-ready — and the admin panel is a text message.

**The loop we must demo:** Merchant texts WhatsApp ("I run a bakery, Brezn €1.20") → live storefront + MCP server exist → a judge's Claude (claude.ai custom connector) browses the catalog and places a pickup order → merchant's phone buzzes with the order → (optional) Claude hands the buyer a Stripe test-mode payment link.

This document is the working contract for the day. Read it fully before writing code.

---

## 0. Operating rules for this build

1. **Risk-first, not feature-first.** Milestones are ordered by integration risk. Do not start a milestone before the previous one's verification gate passes against the _real_ external system (real Render deploy, real claude.ai connector, real Twilio sandbox). Local-only success does not count as passing a gate.
2. **Deploy from hour zero.** Every milestone ends deployed on Render. No "we'll deploy at the end."
3. **Verify SDK reality before coding against memory.** Before Milestone 1, read the current README/docs of `@modelcontextprotocol/sdk` (streamable HTTP server transport, stateless mode) — API names in this plan are directional, not gospel. Same for Twilio's WhatsApp sandbox webhook format and Stripe Payment Links if we reach M5.
4. **Scope test for every addition:** does it live in the empty quadrant (chat → agent-ready bridge) or a crowded one (storefront polish, payment plumbing, admin web UI)? Crowded-quadrant work does not ship today.
5. **Small commits, working tree always deployable.** If a milestone is going sideways for >45 min, stop and ask whether to cut or simplify rather than pushing through.

## Non-goals (hard cuts — do not build even if asked nicely by momentum)

- No admin web UI of any kind. WhatsApp **is** the admin panel; that's the thesis.
- No real payments, no Stripe Connect, no SPT/ACP payment flows. Test-mode Payment Link at most.
- No auth/accounts for buyers. No carts persisted across sessions — order in one tool call.
- No product images upload flow (a placeholder/emoji per product is fine).
- No A2A implementation. One static agent card JSON file only.
- No inventory counts, variants, opening hours, delivery. Products have: name, price, description, available (bool). That's it.

---

## 1. Stack & architecture

- **Runtime:** Node 22, TypeScript (strict), single Render **Web Service** + Render **managed Postgres** (free tier). One process serves everything.
- **HTTP:** Express. (MCP TS SDK's streamable HTTP examples are Express-based; lowest integration risk.)
- **MCP:** `@modelcontextprotocol/sdk` — `McpServer` + streamable HTTP transport mounted at `POST /mcp`, **stateless mode** (no session IDs) so Render restarts/redeploys are invisible to connected clients.
- **DB:** Drizzle ORM + `postgres` driver. Migrations via `drizzle-kit push` (fine for a hackathon).
- **LLM (merchant-message parsing):** Anthropic SDK, tool-use with a strict schema (see §4).
- **WhatsApp:** Twilio WhatsApp Sandbox. Inbound: form-encoded webhook → `POST /webhooks/twilio`. Outbound: Twilio REST client.
- **Storefront:** server-rendered HTML from template-literal render functions (no template engine, no client JS). Plain and fast on purpose.
- **Stripe (optional, M5):** Payment Links API, test mode.

### Routes

| Route                              | Purpose                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `POST /mcp`                        | MCP streamable HTTP endpoint (stateless)                                      |
| `GET /s/:slug`                     | Storefront HTML for a shop                                                    |
| `GET /s/:slug/llms.txt`            | Plain-text agent guidance + MCP URL                                           |
| `GET /.well-known/agent-card.json` | Static A2A-style card pointing at the MCP endpoint (future-proofing flourish) |
| `POST /webhooks/twilio`            | Inbound WhatsApp                                                              |
| `GET /healthz`                     | Render health check / keep-alive target                                       |
| `GET /`                            | Landing: one paragraph + link to demo shop                                    |

### Multi-tenancy

Shops are keyed by the merchant's WhatsApp number (`From` on the webhook). First message from an unknown number creates a shop (slug generated from the shop name once known). This is nearly free and strengthens the pitch ("any merchant texts in, gets a shop"). **Fallback if it causes any friction:** hardcode one demo shop and move on.

MCP tools take `shop_slug` as a parameter so one MCP endpoint serves all shops. (Per-shop MCP URLs are a v2 idea; do not build.)

---

## 2. Data model (complete — resist additions)

```ts
shops:      id, slug (unique), phone (unique, E.164), name, tagline,
            description, status ('draft'|'live'), config jsonb,
            draft_config jsonb, preview_token, created_at
            // config / draft_config: { css?, moodPrompt?, headerImage?, menuImage? }
            // live look vs. pending preview; restyle flow, see §M6

products:   id, shop_id FK, name, description, price_cents int, currency ('EUR'),
            available bool default true, sort int, created_at

orders:     id, shop_id FK, items jsonb [{product_id, name, qty, price_cents}],
            customer_name, pickup_time text, note text,
            total_cents, status ('placed'|'confirmed'|'rejected'),
            payment_link_url nullable, created_at
```

---

## 3. Milestones

### M0 — Walking skeleton through the scariest integration (gate: claude.ai talks to us)

1. Scaffold: TS + Express + healthz, Dockerfile or Render Node build, deploy to Render. Attach Postgres, run a trivial Drizzle migration.
2. Mount MCP server at `/mcp`, stateless, with one dummy tool `ping` returning `"pong from <env>"`.
3. **Gate:** add the deployed URL as a custom connector in claude.ai (Settings → Connectors → custom, no auth), call `ping` from a Claude chat, get the answer. Screenshot it.
4. Note for the human: also verify it connects from ChatGPT developer mode if time at end of day (M6 stretch slide), not now.

**If this gate fails, everything stops until it passes.** Debug aids: check claude.ai connector error messages, MCP SDK docs on required CORS/headers for streamable HTTP, confirm Render gives plain HTTPS with no auth challenge.

### M1 — WhatsApp loop (gate: round trip on a real phone)

1. Twilio sandbox configured; webhook pointed at the Render URL.
2. `POST /webhooks/twilio` parses `From`/`Body` (form-encoded!), replies via TwiML or REST with an echo.
3. Outbound helper `sendWhatsApp(toE164, body)` used from anywhere in the app.
4. **Gate:** human texts the sandbox from their phone, gets the echo; a test endpoint triggers an unsolicited outbound message that arrives. (Sandbox 24h session rules apply — re-join if outbound fails.)
5. Skip Twilio signature validation; leave a `// TODO(prod)` marker.

### M2 — Merchant brain (gate: text in → rows changed → confirmation out)

1. Anthropic tool-use call (see §4) maps an inbound merchant message to zero or more mutations.
2. Apply mutations in a transaction; reply with a **deterministic, templated echo of the interpretation** — never freeform LLM prose for confirmations:
   - `✅ Shop "Bäckerei Demo" created → https://…/s/baeckerei-demo`
   - `✅ Brezn — €1.20 — available`
   - `🤔 Couldn't parse that. Try: "I sell <name> for <price>" or "remove <name>" or "set tagline to <text>"`
3. Unknown sender → create draft shop, ask for the shop name. Known sender → mutate their shop.
4. **Gate (scripted, must pass verbatim):**
   - "I run a bakery on Belgradstraße called Bäckerei Demo" → shop created, link returned
   - "I sell Brezn for 1.20 and Butterbrezn for 1 euro 80" → two products
   - "Brezn are sold out" → available=false
   - "actually Butterbrezn is 1.90" → price updated
   - gibberish → graceful 🤔 reply, no rows touched

### M3 — The storefront's three faces (gate: full demo loop end to end)

1. **MCP tools (real ones, replace `ping`):**
   - `list_shops()` → live shops (slug, name, tagline)
   - `get_catalog(shop_slug)` → shop info + available products with prices
   - `place_order(shop_slug, items[{product_name|product_id, qty}], customer_name, pickup_time, note?)` → validates against catalog, writes order, **sends WhatsApp to merchant**, returns confirmation text: order number, itemized total, pickup time, "pay at pickup".
   - Tool descriptions are product copy for agents — write them carefully (e.g. place_order: "Places a binding pickup order. Always confirm items, pickup time, and customer name with the user before calling.").
2. **HTML storefront** `GET /s/:slug`: name, tagline, product list with prices, "Order via your AI assistant — MCP endpoint: <url>" footer, schema.org `Product`/`LocalBusiness` JSON-LD in the head.
3. `llms.txt` per shop and the static agent card.
4. **Gate — the money shot, run it for real:** fresh Claude chat with the connector → "Find the bakery and order two Brezn for pickup at 16:00, name Timm" → order row exists, merchant phone buzzes with a well-formatted order message, Claude relays the confirmation. Run it twice.

### M4 — Demo hardening (gate: two clean back-to-back runs)

1. Seed script for a believable fallback shop (in case live merchant-creation misbehaves on stage).
2. Keep-alive: external pinger (UptimeRobot or a cron hitting `/healthz`) so Render isn't cold during judging.
3. A `pnpm demo:reset` script: wipes orders, restores seed state.
4. Re-run the **entire** demo script (§5) from blank phone + fresh Claude chat, twice, on a phone hotspot.

### M5 — Optional: payment beat

`place_order` additionally creates a Stripe **test-mode Payment Link** for the order total and includes it in both Claude's confirmation and the merchant WhatsApp. One API call + one nullable column (already in schema). **Cut without guilt if >45 min.**

### M6 — Stretch (only if M0–M4 are rock solid)

In strict priority order:

1. **Vibe restyle (shipped, expanded):** merchant texts "make it feel Bavarian and rustic" → Sonnet emits a **real custom stylesheet** (layered over the base theme in `ui.ts`, **sanitized** against `</style>` breakout + `@import`) plus a saved `moodPrompt`. When images are requested, `gpt-image-2` generates a mood banner + a printable full-menu poster (the storefront's "image variant" toggle), both driven by the moodPrompt; the poster regenerates when the menu changes. The new look lands in `draft_config` and the bot replies with a **token-gated preview link** (`/s/:slug?preview=…`); the merchant replies `ok` to publish (copies draft→live) or `revert` to discard. **NOTE:** this deliberately reverses the original "the LLM never emits raw CSS" guardrail — raw CSS is now allowed but layered + sanitized, with the base theme as a safe floor.
2. **Second agent:** connect the same MCP URL in ChatGPT developer mode → "one server, every agent" slide.
3. **Confirm/reject:** merchant replies `1`/`2` to an order message → status update (+ buyer has no channel, so this only updates the storefront/order state — keep expectations modest).

---

## 4. LLM parsing contract (M2)

Single Anthropic call, `tool_choice` forcing the mutation tool, with this shape:

```ts
apply_merchant_update: {
  actions: Array<
    | { type: "create_or_update_shop"; name?; tagline?; description? }
    | { type: "upsert_product"; name; price_cents?; description?; available? }
    | { type: "remove_product"; name }
    | { type: "set_availability"; name; available }
    | { type: "set_config"; accentColor?; font?; heroBlurb? } // M6 only
    | { type: "unparseable"; reason }
  >;
}
```

Rules: prices arrive in merchant-speak ("1 euro 80", "1,20") — the model normalizes to cents; product matching by case-insensitive name; if ambiguous, prefer `unparseable` over guessing. System prompt includes the shop's current product list so updates resolve correctly. German and English input must both work (demo is in English, merchant persona is German).

---

## 5. Demo script (≤3 min, four beats)

1. **Blank phone.** Text the sandbox: "I run a bakery on Belgradstraße called Bäckerei Demo. I sell Brezn for 1.20 and Butterbrezn for 1.80." Show the ✅ replies and the link.
2. **The site exists.** Open `/s/baeckerei-demo` on the projector.
3. **The agent orders.** Fresh Claude chat (connector pre-added): "Order two Brezn from Bäckerei Demo for pickup at 16:00, name's on the order: Alex." Claude calls the tools, confirms.
4. **The merchant's phone buzzes.** Hold it up. Read the order aloud.
5. _(M5 only)_ Claude shows the payment link; open it, show Stripe test checkout.

Close: the one-liner from the top of this file. If asked "isn't this X?": Shopify Agentic Plan / store.link each do half — show me their onboarding for a bakery with no domain name.

---

## 6. Environment & config

```
DATABASE_URL=            # Render Postgres
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=    # whatsapp:+14155238886 (sandbox)
STRIPE_SECRET_KEY=       # test mode, M5 only
PUBLIC_BASE_URL=         # https://<app>.onrender.com
```

Repo layout:

```
src/
  index.ts          // express app, route mounting
  mcp.ts            // McpServer + tools
  db/schema.ts      // drizzle schema (§2)
  merchant/parse.ts // anthropic tool-use call (§4)
  merchant/apply.ts // mutations + templated confirmations
  whatsapp.ts       // twilio in/out
  storefront.ts     // html render fns + json-ld
  stripe.ts         // M5
scripts/seed.ts, scripts/demo-reset.ts
```

---

## 7. Known risks & pre-decided answers

| Risk                                          | Decision                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| claude.ai connector won't accept the endpoint | M0 exists precisely to surface this at hour 0. Fall back: demo via Claude Code / MCP inspector as the client and present it honestly. |
| Twilio sandbox session expiry mid-demo        | Re-join sandbox 10 min before demo; M4 dry-runs catch this.                                                                           |
| LLM mis-parses merchant text on stage         | Deterministic echo + scripted demo phrases verified in M2 gate; seed shop as fallback.                                                |
| Render cold start during judging              | Keep-alive pinger (M4).                                                                                                               |
| Venue wifi                                    | Demo on phone hotspot; nothing in the demo runs locally anyway.                                                                       |
| Multi-tenancy edge cases eat time             | Pre-authorized fallback: hardcode single shop, no debate needed.                                                                      |
