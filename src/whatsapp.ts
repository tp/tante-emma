// Twilio WhatsApp sandbox integration (M1).
//
// Inbound:  Twilio POSTs a form-encoded webhook to /webhooks/twilio. We reply
//           with TwiML (an XML <Message>) so Twilio delivers the echo — this path
//           needs no outbound credentials.
// Outbound: sendWhatsApp() calls the Twilio REST API directly with fetch (Node 22
//           has global fetch), so we add zero dependencies and nothing to install
//           on Render. Used from anywhere in the app (M3 sends order alerts here).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  PUBLIC_BASE_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  requireEnv,
} from './env.js';
import { handleMerchantMessage } from './merchant/apply.js';

/** Twilio's `From` arrives as `whatsapp:+49…`; strip the channel prefix to E.164. */
function fromWhatsAppNumber(value: string): string {
  return value.replace(/^whatsapp:/, '').trim();
}

/** Minimal XML escaping for text placed inside a TwiML <Message> element. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build a TwiML document that replies to an inbound message with one message. */
export function twimlMessage(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`;
}

/**
 * Normalize a phone number to Twilio's `whatsapp:+E164` channel address.
 * Tolerant of inputs where the leading `+` was lost — e.g. a query string
 * decodes `?to=+49…` into a leading space, and some callers omit the `+`.
 */
function toWhatsAppAddress(value: string): string {
  let n = value.trim();
  if (n.startsWith('whatsapp:')) n = n.slice('whatsapp:'.length).trim();
  if (!n.startsWith('+')) n = `+${n.replace(/^\++/, '')}`;
  return `whatsapp:${n}`;
}

/**
 * Send a WhatsApp message via the Twilio REST API. `to` may be a bare E.164
 * number (+49…) or an already-prefixed `whatsapp:+49…` address. `mediaUrls` are
 * publicly-reachable image URLs delivered inline (e.g. a restyle preview). Throws
 * on a non-2xx Twilio response so callers can surface delivery failures.
 */
export async function sendWhatsApp(
  to: string,
  body: string,
  mediaUrls: string[] = [],
): Promise<void> {
  const sid = requireEnv('TWILIO_ACCOUNT_SID');
  const token = requireEnv('TWILIO_AUTH_TOKEN');
  const from = requireEnv('TWILIO_WHATSAPP_FROM');

  const form = new URLSearchParams({
    From: toWhatsAppAddress(from),
    To: toWhatsAppAddress(to),
    Body: body,
  });
  for (const url of mediaUrls) form.append('MediaUrl', url);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Twilio send failed (${res.status}): ${detail}`);
  }
}

/**
 * Verify Twilio's `X-Twilio-Signature` on an inbound webhook request. This is the
 * *entire* authentication for the merchant admin surface: without it, `From` is a
 * spoofable form field and anyone who can POST here can impersonate any merchant.
 *
 * Twilio's scheme: HMAC-SHA1, keyed with the auth token, over the exact public URL
 * it POSTed to followed by every form param appended in sorted key order as
 * `key + value`; the result is base64 and must equal the header. We reconstruct the
 * URL from PUBLIC_BASE_URL (not `req`) because Render terminates TLS — `req.protocol`
 * would be `http` and the host internal, so a `req`-derived URL never matches.
 *
 * Implemented with the built-in `crypto` to keep the zero-dependency posture (no
 * `twilio` SDK). Returns false when the token is unset so local/M0 boots without it.
 */
function isValidTwilioSignature(req: Request): boolean {
  if (!TWILIO_AUTH_TOKEN) return false;
  const signature = req.get('X-Twilio-Signature');
  if (!signature) return false;

  const url = `${PUBLIC_BASE_URL}${req.originalUrl}`;
  const params = req.body as Record<string, unknown>;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key]), url);

  const expected = createHmac('sha1', TWILIO_AUTH_TOKEN).update(data, 'utf8').digest('base64');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Register the inbound webhook and a debug outbound endpoint. */
export function mountWhatsApp(app: Express): void {
  // Inbound WhatsApp. Twilio sends application/x-www-form-urlencoded with
  // `From`, `Body`, etc. The merchant brain (M2) parses the message, applies
  // catalog mutations, and returns a templated confirmation we reply with via
  // TwiML.
  //
  // Merchant authority *is* the `From` field, so we verify the X-Twilio-Signature
  // before trusting it — otherwise anyone who can POST here can spoof any merchant
  // and take over their shop. Rejected before any DB/LLM work. Enforced whenever
  // TWILIO_AUTH_TOKEN is set (always on Render); skipped with a warning locally so
  // M0/M1 can boot without creds.
  app.post('/webhooks/twilio', async (req: Request, res: Response) => {
    if (TWILIO_AUTH_TOKEN) {
      if (!isValidTwilioSignature(req)) {
        console.warn('[whatsapp] rejected webhook: invalid X-Twilio-Signature');
        res.status(403).type('text/plain').send('Invalid signature');
        return;
      }
    } else {
      console.warn(
        '[whatsapp] TWILIO_AUTH_TOKEN unset — skipping signature check (do not run public)',
      );
    }
    const phone = fromWhatsAppNumber(String(req.body.From ?? ''));
    const text = String(req.body.Body ?? '').trim();
    console.log(`[whatsapp] inbound from ${phone}: ${text}`);
    try {
      const reply = await handleMerchantMessage(phone, text);
      res.type('text/xml').send(twimlMessage(reply));
    } catch (err) {
      console.error('[whatsapp] merchant handling failed:', err);
      res
        .type('text/xml')
        .send(twimlMessage('⚠️ Something went wrong on our end — please try again in a moment.'));
    }
  });

  // Debug-only: trigger an unsolicited outbound message to prove the REST path
  // works (M1 gate step). GET so it's hittable from a browser.
  // TODO(prod): remove or auth-guard this endpoint.
  app.get('/debug/send', async (req: Request, res: Response) => {
    const to = String(req.query.to ?? '');
    if (!to) {
      res.status(400).json({ error: 'pass ?to=+49… (your sandbox-joined number)' });
      return;
    }
    const body = String(req.query.body ?? 'Hello from Tante Emma (outbound test).');
    try {
      await sendWhatsApp(to, body);
      res.json({ ok: true, to, body });
    } catch (err) {
      console.error('[whatsapp] debug send failed:', err);
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  console.log(
    `[whatsapp] webhook mounted${TWILIO_ACCOUNT_SID && TWILIO_WHATSAPP_FROM ? '' : ' (outbound creds not yet set)'}`,
  );
}
