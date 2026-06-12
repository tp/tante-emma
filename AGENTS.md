# AGENTS.md — Tante Emma

Operational guide for working in this repo. For the full build contract (milestones, scope cuts, demo script), read [PLAN.md](PLAN.md) — this file is orientation, conventions, and gotchas.

## What this is

A shop that has **no website**, made agent-ready — and the admin panel is a text message. A merchant texts WhatsApp ("I run a bakery, Brezn €1.20"); a live storefront + an MCP server appear; any AI assistant (claude.ai custom connector) browses the catalog and places a pickup order; the merchant's phone buzzes. One Node process serves everything.

## Stack

- **Node 22**, TypeScript (strict), ESM. (Devcontainer runs Node 24 — compatible; `engines` and Render are pinned to 22.)
- **Express 5** — one process, all routes.
- **MCP**: `@modelcontextprotocol/sdk` 1.29, `McpServer` + streamable HTTP, **stateless** (no session IDs), mounted at `POST /mcp`.
- **DB**: Drizzle ORM + `postgres` driver, Postgres.
- **LLM**: `@anthropic-ai/sdk`, `claude-haiku-4-5` for merchant-message parsing (fast/cheap, German+English).
- **WhatsApp**: Twilio sandbox. Inbound webhook (form-encoded) + outbound via REST (`fetch`, no SDK).
- **Deploy**: Render Blueprint ([render.yaml](render.yaml)) — Web Service (`starter`) + managed Postgres (`basic-256mb`), Frankfurt.

## Layout

| Path | Role |
| --- | --- |
| [src/index.ts](src/index.ts) | Express entrypoint: `/healthz`, landing `/`, mounts MCP + WhatsApp, runs migrations on boot |
| [src/env.ts](src/env.ts) | Centralised env access. `PORT`, `PUBLIC_BASE_URL` (trailing slash stripped), `ENV_LABEL`, Twilio vars, `requireEnv()` |
| [src/mcp.ts](src/mcp.ts) | MCP server. Stateless streamable HTTP at `POST /mcp`. Currently the `ping` tool (replaced by real tools in M3) |
| [src/whatsapp.ts](src/whatsapp.ts) | Twilio inbound webhook → merchant brain; `sendWhatsApp(to, body)` outbound helper; `/debug/send` test endpoint |
| [src/merchant/parse.ts](src/merchant/parse.ts) | One forced-tool Anthropic call → validated `MerchantAction[]` (PLAN §4) |
| [src/merchant/apply.ts](src/merchant/apply.ts) | Applies actions in a transaction → **templated** WhatsApp reply; slug generation |
| [src/db/schema.ts](src/db/schema.ts) | **Canonical schema** (PLAN §2). Edit tables here |
| [src/db/index.ts](src/db/index.ts) | Lazy Drizzle client (`getDb()`) — boots without `DATABASE_URL` |
| [src/db/migrate.ts](src/db/migrate.ts) | Applies `drizzle/*.sql` at startup, non-blocking |
| [drizzle/](drizzle/) | **Generated** migration SQL (committed — it's what runs in prod) |
| `scripts/` | `seed.ts`, `demo-reset.ts` (M4 demo hardening) |

## Routes

| Route | Purpose | Status |
| --- | --- | --- |
| `POST /mcp` | MCP streamable HTTP (stateless) | M0 ✅ (`ping`) |
| `POST /webhooks/twilio` | Inbound WhatsApp → merchant brain | M1/M2 ✅ |
| `GET /debug/send?to=%2B49…` | Outbound test (encode `+` as `%2B`) | M1 ✅ |
| `GET /healthz` | Render health check | M0 ✅ |
| `GET /` | Landing page | M0 ✅ |
| `GET /s/:slug` + `llms.txt` | Storefront | **M3 — not built** |
| `GET /.well-known/agent-card.json` | A2A card | **M3 — not built** |

## DB workflow

The schema lives in **TypeScript**, not in SQL or the migrator:

```
edit src/db/schema.ts  →  pnpm db:generate  →  commit drizzle/*.sql  →  auto-applies on next boot
```

- `db:generate` diffs the schema offline (no DB needed) and emits numbered SQL into `drizzle/`.
- `src/db/migrate.ts` applies pending SQL at startup, **idempotent** (drizzle tracks applied migrations) and **non-blocking** (a DB problem logs but never crashes the process — `/healthz` and MCP `ping` keep serving).
- Runtime never auto-diffs the schema — it only applies committed SQL files. **A schema change without a fresh `db:generate` won't reach prod.**
- `pnpm db:push` still exists as a local escape hatch but isn't needed for deploy.

## Conventions

- **Naming**: slug form `tante-emma` for identifiers/URLs; display `Tante Emma` for human-facing text.
- **Multi-tenancy key** is the merchant's E.164 phone (`shops.phone`, unique). Twilio's `From` is `whatsapp:+49…`; strip the prefix.
- **Confirmations are deterministic templates, never freeform LLM prose** (PLAN §M2.2). A mis-parse must never produce a convincing-but-wrong confirmation. The LLM only parses; `apply.ts` writes the reply.
- **Lazy clients** (DB in `db/index.ts`, Anthropic in `parse.ts`): the app boots and serves `/healthz` + MCP `ping` even with no secrets/DB. This is the M0 risk guarantee — don't make boot depend on external services.
- MCP tool descriptions are **product copy for agents** — write them carefully (M3).

## Gotchas

- **MCP SDK paths**: use the published 1.29 classic imports (`@modelcontextprotocol/sdk/server/mcp.js`). The GitHub `main` README shows an *unreleased* modular split (`@modelcontextprotocol/express`, etc.) — **do not copy it**, it won't resolve.
- **`+` in URLs decodes to a space** — the `/debug/send` and any phone-in-querystring must encode `+` as `%2B`. `whatsapp.ts` normalises defensively, but be aware.
- **Twilio sandbox**: 24h session per joined number; re-join (`join <code>`) if outbound stops. Outbound only works to sandbox-joined numbers. Signature validation is skipped (`// TODO(prod)`).
- **Devcontainer pnpm store**: the original `node_modules` was hardlinked to a Docker store at `/app` that doesn't exist in this filesystem. If deps break, run `pnpm install` (store-dir is set to a local path via `.npmrc`, which is gitignored). `corepack enable` errors on a symlink perm — ignore it, `pnpm` works directly. Run TS with `pnpm <script>` or `./node_modules/.bin/tsx`.

## Dev commands

```bash
pnpm typecheck          # tsc --noEmit — run before every commit
pnpm dev                # tsx watch
pnpm start              # tsx (Render start command)
pnpm db:generate        # regenerate migration SQL after editing schema.ts
pnpm db:push            # local-only schema push (escape hatch)
```

Local boot needs nothing; full function needs `DATABASE_URL`, `ANTHROPIC_API_KEY`, `TWILIO_*` (see [.env.example](.env.example)).

## Deploy & env

- Push to `main` → Render Blueprint deploys (`branch: main` in render.yaml). Migrations apply on boot.
- Public URL: `https://tante-emma.onrender.com`, MCP at `…/mcp`.
- `sync: false` env vars (set by hand in Render dashboard): `PUBLIC_BASE_URL` (= the onrender URL, no trailing slash), `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `STRIPE_SECRET_KEY` (M5).
- `DATABASE_URL` is injected from the managed Postgres automatically.

## Milestone status

- **M0** ✅ Walking skeleton — claude.ai connector calls `ping` → `pong from render`.
- **M1** ✅ WhatsApp loop — inbound + outbound verified on a real phone.
- **M2** ✅ Merchant brain built (parse → mutate → templated reply). **Gate pending**: set `ANTHROPIC_API_KEY`, push, run the scripted sequence (PLAN §M2.4) over WhatsApp.
- **M3** ⏭ Real MCP tools (`list_shops`/`get_catalog`/`place_order`) + storefront `/s/:slug` + `llms.txt` + agent card. The money-shot demo loop.
- **M4–M6**: demo hardening, optional Stripe, stretch (vibe restyle / second agent). See PLAN.
