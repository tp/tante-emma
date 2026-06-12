# Tante Emma

The shop that doesn't have a website, made agent-ready — and the admin panel is a
text message. See [PLAN.md](PLAN.md) for the full build contract.

## Stack

Node 22 · TypeScript (strict) · Express 5 · `@modelcontextprotocol/sdk` (stateless
streamable HTTP) · Drizzle ORM + `postgres` · deployed on Render (Web Service +
managed Postgres).

## Layout

```
src/
  index.ts        express app, route mounting, healthz, landing
  env.ts          environment access
  mcp.ts          MCP server + tools, mounted at POST /mcp (stateless)
  db/schema.ts    drizzle schema (shops, products, orders)
  db/index.ts     lazy drizzle client
scripts/          seed.ts, demo-reset.ts (M4)
render.yaml       Render blueprint
```

## Local development

No Node on your host? This repo was built and smoke-tested entirely in Docker:

```bash
# install + typecheck
docker run --rm -v "$PWD":/app -w /app node:22 \
  bash -lc 'corepack enable && pnpm install && pnpm typecheck'

# run the server (http://localhost:3000)
docker run --rm -p 3000:3000 -v "$PWD":/app -w /app -e PORT=3000 node:22 \
  bash -lc 'corepack enable && pnpm start'
```

With Node installed natively, it's just `pnpm install` then `pnpm dev`.

Copy `.env.example` to `.env` and fill in as milestones require. The walking
skeleton (`/healthz` + MCP `ping`) needs no env vars at all.

### Smoke-test the MCP endpoint

```bash
curl localhost:3000/healthz

curl -s localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
# -> data: {"result":{"content":[{"type":"text","text":"pong from local"}]},...}
```

## Deploy to Render (M0)

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo. `render.yaml` provisions
   the Web Service + free Postgres and wires `DATABASE_URL`.
3. After the first deploy, set `PUBLIC_BASE_URL` to the service's
   `https://<service>.onrender.com` URL and redeploy.
4. The other secrets (`ANTHROPIC_API_KEY`, `TWILIO_*`, `STRIPE_SECRET_KEY`) are
   `sync: false` — add them in the dashboard as each milestone needs them.

`db:push` is deliberately **not** in the build command (the M0 gate needs no
tables). When the schema is needed (M2), run it against the live DB:

```bash
DATABASE_URL='<render external connection string>' pnpm db:push
```

## M0 gate — claude.ai talks to us

1. Confirm the deploy: open `https://<service>.onrender.com/healthz`.
2. In **claude.ai → Settings → Connectors → Add custom connector**, no auth,
   URL = `https://<service>.onrender.com/mcp`.
3. In a Claude chat, ask it to call the `ping` tool. Expect **`pong from render`**.
4. Screenshot it. **If this gate fails, everything stops until it passes** (see
   PLAN.md §7 for fallbacks).

## Routes

| Route | Purpose | Milestone |
| --- | --- | --- |
| `GET /healthz` | Health check / keep-alive | M0 |
| `POST /mcp` | MCP streamable HTTP (stateless) | M0 |
| `GET /mcp` · `DELETE /mcp` | 405 (stateless has no sessions) | M0 |
| `GET /` | Landing page | M0 |
| `POST /webhooks/twilio` | Inbound WhatsApp | M1 |
| `GET /s/:slug` | Storefront HTML | M3 |
| `GET /s/:slug/llms.txt` | Agent guidance | M3 |
| `GET /.well-known/agent-card.json` | A2A-style card | M3 |
