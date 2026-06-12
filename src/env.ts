// Centralised environment access. Read lazily so the process can boot for the
// M0 walking skeleton (healthz + MCP ping) even before secrets/DB are wired up.

export const PORT = Number(process.env.PORT ?? 3000);

// No trailing slash. Used to build storefront/MCP URLs shown to agents & merchants.
export const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`
).replace(/\/+$/, '');

// A short label for where this instance runs, surfaced by the `ping` tool so the
// M0 gate screenshot proves *which* deployment claude.ai reached.
export const ENV_LABEL = process.env.RENDER ? 'render' : 'local';

/** Read a required env var, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
