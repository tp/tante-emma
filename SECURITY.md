# SECURITY.md — Permissions & trust model

How Tante Emma decides *who may do what*. Companion to [PLAN.md](PLAN.md)
(build contract) and [AGENTS.md](AGENTS.md) (conventions). This describes the
state as of M3/M4 (demo) and flags what must change before real merchants or
real money.

## The core design: two surfaces, one of them isn't on the web

There are exactly two ways to change state, and they are deliberately split:

| Surface | Who | Transport | Can do | Identity |
| --- | --- | --- | --- | --- |
| **Admin / merchant** | shop owners | WhatsApp → `POST /webhooks/twilio` | create/edit/remove products, set shop name/tagline, mark orders ready | E.164 phone number |
| **End-user / agent** | buyers & their AI assistants | `POST /mcp`, `GET /s/:slug`, `GET /o/:id` | list shops, read catalogs, place a (payment-gated) order, pay, watch status | anonymous |

The important property: **there is no web admin panel.** The only HTTP write
endpoints are the Twilio webhook (machine-to-machine), the fake-pay endpoint,
and the debug sender. A merchant can never be impersonated through a
shop-management HTTP route because no such route exists — the admin API *is* the
inbound WhatsApp channel. "The admin panel is a text message" is a security
posture, not just a tagline.

## Admin surface — how merchant authority works

- **Identity = the merchant's phone number.** Twilio delivers the sender in the
  `From` field; [whatsapp.ts](src/whatsapp.ts) strips the `whatsapp:` prefix to
  E.164 and passes it to `handleMerchantMessage(phone, message)`.
- **The phone number is the multi-tenancy key.** `shops.phone` is `unique`
  ([schema.ts](src/db/schema.ts)). Every merchant action resolves the shop from
  the texting phone and scopes mutations to it
  ([apply.ts](src/merchant/apply.ts)). An unknown sender gets a *draft* shop the
  moment they name it — there is no separate signup/authz step.
- **Tenant isolation is enforced in code, not just by convention:**
  - product create/update/remove operate only on the shop resolved from `phone`.
  - `markReady(shop.id, orderNumber)` filters by `shopId` *and* `status='paid'`
    ([orders.ts](src/orders.ts#L139)), so a merchant can only ready their own
    paid orders — texting `#12` can never touch another shop's order #12.
- **Confirmations are deterministic templates, never LLM prose.** The model in
  [parse.ts](src/merchant/parse.ts) only *parses* into validated actions;
  `apply.ts` writes the reply by echoing what it actually did. A mis-parse can't
  produce a convincing-but-wrong "✅ done."

### ✅ The `From` field is now authenticated via X-Twilio-Signature

`POST /webhooks/twilio` validates the `X-Twilio-Signature` header before trusting
`From` (`isValidTwilioSignature` in [whatsapp.ts](src/whatsapp.ts)). Because
merchant authority is "you are whatever phone number is in `From`," this signature
check *is* the entire admin authentication: a request whose HMAC-SHA1 (keyed with
`TWILIO_AUTH_TOKEN`) over the public URL + sorted form params doesn't match is
rejected with `403` before any DB or LLM work. The signed URL is rebuilt as
`PUBLIC_BASE_URL + req.originalUrl`: the **origin** comes from `PUBLIC_BASE_URL`
(not `req`, since Render terminates TLS — a `req`-derived scheme/host would be
`http`/internal and never match what Twilio signed), while the **path + query**
come from `req.originalUrl`, so they track whatever Twilio actually requested.

Enforced whenever `TWILIO_AUTH_TOKEN` is set (always true on Render); skipped with
a loud warning when unset so the local/M0 walking skeleton still boots.
**Operational prerequisite:** `PUBLIC_BASE_URL` must equal the scheme + host that
the Twilio Console webhook is configured with. The path portion is self-correcting
— a trailing slash (`/webhooks/twilio/`, as currently configured) is fine, because
it's reconstructed from `req.originalUrl` and so appears identically on both sides;
only an **origin** mismatch (wrong scheme or host) makes valid requests `403`.

## End-user / agent surface — anonymous by design

- **MCP (`POST /mcp`)** is stateless and unauthenticated. `list_shops`,
  `get_catalog`, `place_order` are open to any agent — intentional. CORS is `*`
  ([mcp.ts:131](src/mcp.ts#L131)); fine, because there are no cookies or
  credentials to steal.
- **Anonymous ordering is bounded by the payment gate.** `place_order` writes the
  order in `pending_payment` and notifies *nobody*. The merchant's phone only
  buzzes after `markPaid` ([orders.ts:101](src/orders.ts#L101)). So an
  anonymous-order spammer just accumulates unpaid DB rows — the merchant is
  insulated until money moves. `markPaid` is the single "payment confirmed" seam,
  which is exactly where real payment verification (M5 Stripe webhook) will slot
  in.
- **Storefront / llms.txt** are public read-only catalog views — no concern.

### Known end-user gaps (acceptable for the demo)

- **Order pages are IDOR-able.** `/o/:id` uses the sequential `serial` order id,
  so `/o/1`, `/o/2`… enumerate other buyers' orders and leak customer name,
  items, pickup time, and note ([order_page.ts:112](src/order_page.ts#L112)).
- **The pay endpoint is open.** `POST /o/:id/pay` marks any pending order paid
  with no verification ([order_page.ts:122](src/order_page.ts#L122)). Labelled
  "demo — no real charge"; it is a stand-in for the M5 Stripe webhook and must be
  replaced, not auth-guarded.
- **`/debug/send` is unauthenticated** outbound WhatsApp
  ([whatsapp.ts:104](src/whatsapp.ts#L104), `// TODO(prod): remove or
  auth-guard`). Sandbox-only and limited to sandbox-joined numbers, so low blast
  radius today.
- **No rate limiting anywhere.** Order spam, order-id enumeration, and per-inbound
  Anthropic-call cost are all unthrottled.

## Now vs. harden-later

**Do now (if this is reachable at a public URL, not just a private demo):**

1. ~~**Validate `X-Twilio-Signature`** on `/webhooks/twilio`.~~ ✅ **Done** —
   `isValidTwilioSignature` in [whatsapp.ts](src/whatsapp.ts) verifies the header
   against `TWILIO_AUTH_TOKEN` and rejects mismatches with `403` before any work.
   Implemented with built-in `crypto` (no `twilio` SDK) to keep the zero-dependency
   posture. See the ✅ section above for the operational prerequisite.
2. **Remove or auth-guard `/debug/send`** before any non-sandbox deploy.

**Document and defer (fine for the demo; required before real merchants/money):**

3. **Unguessable order URLs.** Replace the sequential id in `/o/:id` with an
   opaque token (random column or signed id) to close the IDOR. Needed before any
   real customer PII flows through orders.
4. **Replace `/o/:id/pay` with the Stripe webhook (M5).** `markPaid` is already
   the single seam; the open POST disappears, payment authority moves to a
   signature-verified Stripe callback.
5. **Rate limiting** on `/mcp` (orders), `/webhooks/twilio` (LLM cost), and the
   order routes (enumeration). Add when leaving the demo.

The honest summary: the *architecture* is sound — admin and buyer surfaces are
cleanly separated, tenant isolation is enforced in code, and the payment gate
bounds anonymous abuse. The *authentication* on the admin surface (#1) is the one
gap that is a present takeover risk rather than a future hardening task.
