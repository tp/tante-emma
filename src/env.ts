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

// Twilio WhatsApp sandbox credentials. Read lazily (via requireEnv at call time)
// so the app still boots for M0/M1 inbound echo before outbound is wired.
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
export const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? '';
// Used both for outbound REST auth and to verify the X-Twilio-Signature on the
// inbound webhook — the only thing authenticating the merchant admin surface.
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';

/** Read a required env var, throwing a clear error if missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
