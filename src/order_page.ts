// Buyer-facing order page (M3.5). The agent hands the buyer the /o/:id link from
// placeOrder. The page shows the order as a little receipt, a "Pay now" button
// while pending, and a status banner that POLLS so it updates live through
// pending_payment → paid → ready. This is the ONLY page with client-side JS (the
// poller) — live status is inherently client-side; the storefront stays no-JS.

import type { Express, Request, Response } from 'express';
import { euro } from './format.js';
import { layout, esc } from './ui.js';
import { getOrderForPage, markPaid } from './orders.js';
import type { Order, OrderStatus } from './db/schema.js';

const BANNER: Record<OrderStatus, { text: string; cls: string }> = {
  pending_payment: { text: 'Awaiting payment', cls: 'pending' },
  paid: { text: '✅ Paid — the shop is preparing your order…', cls: 'paid' },
  ready: { text: '🎉 Your order is ready for pickup!', cls: 'ready' },
};

const PAGE_STYLES = `
.receipt .lines{list-style:none;margin:0;padding:0}
.receipt .lines li{display:flex;align-items:baseline;gap:.5rem;padding:.42rem 0}
.receipt .q{color:var(--muted);font-variant-numeric:tabular-nums;min-width:1.9rem}
.receipt .n{font-weight:600}
.receipt .lines li .price{margin-left:auto}
.receipt .rule{border-top:2px dashed var(--line);margin:.8rem 0}
.receipt .total{display:flex;font-weight:700;font-size:1.08rem}
.receipt .total .price{margin-left:auto;color:var(--ink)}
.receipt .note{color:var(--muted);margin:.7rem 0 0}
#banner{margin:1.8rem 0;padding:1.05rem 1.25rem;border-radius:13px;text-align:center;
  font-size:1.13rem;font-weight:600;border:1px solid transparent}
#banner.pending{background:var(--amber-soft);color:var(--amber-ink);border-color:#EAD9AE}
#banner.paid{background:var(--paid);color:var(--green-dk);border-color:#C6E0CE}
#banner.ready{background:var(--green);color:#fff}
form#pay{text-align:center;margin:1.5rem 0 .5rem}
form#pay .demo{display:block;margin-top:.55rem;font-size:.82rem}
@media (prefers-reduced-motion:no-preference){
  #banner.pop{animation:pop .55s ease}
  @keyframes pop{0%{transform:scale(.94)}55%{transform:scale(1.04)}100%{transform:scale(1)}}
}
`;

export function renderOrderPage(order: Order): string {
  const lines = order.items
    .map(
      (l) =>
        `<li><span class="q">${l.qty}×</span> <span class="n">${esc(l.name)}</span><span class="price">${euro(l.qty * l.priceCents)}</span></li>`,
    )
    .join('\n');
  const banner = BANNER[order.status];
  const pending = order.status === 'pending_payment';

  const body = `
<h1>Order #${order.id}</h1>
<p class="muted">Pickup ${esc(order.pickupTime ?? '—')} · for ${esc(order.customerName)}</p>

<div class="card receipt">
  <ul class="lines">
${lines}
  </ul>
  <div class="rule"></div>
  <div class="total"><span>Total</span><span class="price">${euro(order.totalCents)}</span></div>
  ${order.note ? `<p class="note">💬 ${esc(order.note)}</p>` : ''}
</div>

<div id="banner" class="${banner.cls}" data-status="${order.status}">${banner.text}</div>

${
  pending
    ? `<form id="pay" method="POST" action="/o/${order.id}/pay">
  <button class="btn" type="submit">Pay now</button>
  <span class="muted demo">demo — no real charge</span>
</form>`
    : ''
}`;

  const bodyEnd = `<script>
  var DONE = ${order.status === 'ready' ? 'true' : 'false'};
  var ST = {
    pending_payment: ${JSON.stringify(BANNER.pending_payment)},
    paid: ${JSON.stringify(BANNER.paid)},
    ready: ${JSON.stringify(BANNER.ready)}
  };
  var banner = document.getElementById('banner');
  async function poll() {
    if (DONE) return;
    try {
      var r = await fetch(location.pathname.replace(/\\/$/, '') + '/status');
      var d = await r.json();
      var s = d.status;
      if (s && ST[s] && banner.dataset.status !== s) {
        banner.dataset.status = s;
        banner.className = ST[s].cls + (s === 'ready' ? ' pop' : '');
        banner.textContent = ST[s].text;
        var pay = document.getElementById('pay');
        if (pay && s !== 'pending_payment') pay.style.display = 'none';
      }
      if (!s || s === 'ready') return; // stop polling
    } catch (e) { /* keep trying */ }
    setTimeout(poll, 3000);
  }
  poll();
</script>`;

  return layout({
    title: `Order #${order.id} — Tante Emma`,
    body,
    head: `<style>${PAGE_STYLES}</style>`,
    bodyEnd,
  });
}

function notFoundPage(): string {
  return layout({
    title: 'Order not found — Tante Emma',
    body: '<div class="card"><h1>Order not found</h1><p class="muted">This order link doesn\'t point to anything. Double-check the link from your assistant.</p></div>',
  });
}

/** Register the order-page routes. */
export function mountOrderPage(app: Express): void {
  app.get('/o/:id', async (req: Request, res: Response) => {
    const order = await getOrderForPage(Number(req.params.id));
    if (!order) {
      res.status(404).type('html').send(notFoundPage());
      return;
    }
    res.type('html').send(renderOrderPage(order));
  });

  // The fake payment: mark paid (which notifies the merchant), then reload.
  app.post('/o/:id/pay', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    await markPaid(id);
    res.redirect(302, `/o/${id}`);
  });

  // Polled by the order page every 3s.
  app.get('/o/:id/status', async (req: Request, res: Response) => {
    const order = await getOrderForPage(Number(req.params.id));
    res.json({ status: order?.status ?? null });
  });
}
