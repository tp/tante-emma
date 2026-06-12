// Shared visual identity for every server-rendered page (landing, storefront,
// order page) so they feel like one product. A warm "neighbourhood corner shop"
// look — deli green + cream + amber, a system serif for display, an awning
// motif. No external fonts: fast and reliable on Render, no flash-of-unstyled.

/** Escape text for safe interpolation into HTML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
:root{
  --paper:#FBF6EC; --card:#FFFDF8; --ink:#221E18; --muted:#6E665A;
  --line:#E8DEC9; --green:#205C43; --green-dk:#163F2D; --amber:#C6892F;
  --amber-ink:#7C5417; --amber-soft:#F6EACE; --paid:#E3F0E7;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.6;
  -webkit-font-smoothing:antialiased}
a{color:var(--green);text-decoration:none}
a:hover{text-decoration:underline}
.awning{height:.55rem;background:repeating-linear-gradient(90deg,var(--green) 0 26px,#FBEFD4 26px 52px)}
header.site{text-align:center;padding:1.5rem 1rem 1.1rem;border-bottom:1px solid var(--line)}
header.site .wordmark{font-family:var(--serif);font-size:1.55rem;font-weight:700;color:var(--green-dk);
  letter-spacing:.01em;display:inline-block}
header.site .wordmark .dot{color:var(--amber)}
header.site .kicker{margin:.15rem 0 0;font-size:.78rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.hero{max-width:44rem;height:11rem;margin:1.6rem auto 0;border-radius:16px;
  background-size:cover;background-position:center;border:1px solid var(--line)}
main{max-width:38rem;margin:2.4rem auto 1rem;padding:0 1.25rem}
main.wide{max-width:44rem}
h1{font-family:var(--serif);font-weight:700;font-size:2rem;line-height:1.12;margin:.1rem 0 .35rem}
.tagline{color:var(--muted);font-size:1.12rem;margin:.1rem 0 0}
.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:1.5rem 1.6rem;
  box-shadow:0 1px 0 rgba(0,0,0,.02),0 22px 40px -32px rgba(34,30,24,.45)}
.price{color:var(--amber-ink);font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.menu{list-style:none;padding:0;margin:1.4rem 0}
.menu li{display:flex;align-items:baseline;padding:.55rem 0}
.menu li+li{border-top:1px solid var(--line)}
.menu .name{font-weight:600}
.menu .desc{color:var(--muted);font-size:.9rem;margin-left:.5rem;font-weight:400}
.menu .dots{flex:1;margin:0 .5rem;border-bottom:2px dotted var(--line);position:relative;top:-.28rem;min-width:1.2rem}
.menu li.empty{color:var(--muted);justify-content:center;border:0}
.btn,button.btn{display:inline-block;font:inherit;font-size:1.06rem;font-weight:600;line-height:1;
  padding:.85rem 1.7rem;border:0;border-radius:11px;background:var(--green);color:#fff;cursor:pointer;
  transition:background .15s ease,transform .04s ease}
.btn:hover,button.btn:hover{background:var(--green-dk);text-decoration:none}
.btn:active,button.btn:active{transform:translateY(1px)}
.btn:focus-visible,button.btn:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.callout{margin-top:1.6rem;padding:1.1rem 1.25rem;border:1px dashed var(--line);border-radius:14px;
  background:#FFFBF1;color:#4a4034;font-size:.96rem}
code{background:#F1EAD9;padding:.16rem .42rem;border-radius:.35rem;font-size:.9em;word-break:break-all}
footer.site{text-align:center;color:var(--muted);font-size:.82rem;padding:2.2rem 1rem 2.6rem}
footer.site .mark{color:var(--amber)}
@media (max-width:480px){h1{font-size:1.7rem}.card{padding:1.25rem 1.15rem}}
`;

export type LayoutOpts = {
  title: string;
  body: string;
  /** Extra markup for <head> (e.g. JSON-LD). */
  head?: string;
  /** Extra markup before </body> (e.g. a poller script). */
  bodyEnd?: string;
  /** Wider main column. */
  wide?: boolean;
  /** Sanitized custom stylesheet, injected after the base theme (restyle flow). */
  customStyle?: string;
  /** Background-image URL for the .hero banner. Server-controlled (preview-aware). */
  heroImageUrl?: string;
};

/** Wrap page content in the shared shell (awning, header wordmark, footer). */
export function layout(opts: LayoutOpts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${STYLES}</style>
${opts.customStyle ? `<style>${opts.customStyle}</style>` : ''}
${opts.head ?? ''}
</head>
<body>
<div class="awning"></div>
<header class="site">
  <a class="wordmark" href="/">Tante&nbsp;Emma<span class="dot">.</span></a>
  <p class="kicker">the corner shop, agent-ready</p>
</header>
${opts.heroImageUrl ? `<div class="hero" style="background-image:url('${esc(opts.heroImageUrl)}')"></div>` : ''}
<main${opts.wide ? ' class="wide"' : ''}>
${opts.body}
</main>
<footer class="site">
  <span class="mark">✦</span> Tante Emma — the shop that doesn't have a website, made agent-ready.
</footer>
${opts.bodyEnd ?? ''}
</body>
</html>`;
}
