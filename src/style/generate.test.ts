// Run: pnpm test  (node:test via tsx)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCss } from './generate.js';

test('sanitizeCss defangs a </style> element breakout', () => {
  const out = sanitizeCss('.menu{color:red}</style><script>alert(1)</script>');
  assert.ok(!/<\/style>/i.test(out), 'must not contain a literal </style>');
  assert.ok(!/<\/script>/i.test(out), 'must not contain a literal </script>');
  assert.ok(out.includes('.menu{color:red}'), 'keeps the real CSS');
});

test('sanitizeCss is case- and spacing-insensitive to the close tag', () => {
  const out = sanitizeCss('a{}</STYLE >b{}');
  assert.ok(!/<\/style/i.test(out));
});

test('sanitizeCss strips @import rules', () => {
  const out = sanitizeCss("@import url('https://evil.example/x.css');\n.menu{color:red}");
  assert.ok(!/@import/i.test(out), 'no @import survives');
  assert.ok(out.includes('.menu{color:red}'), 'keeps the real CSS');
});

test('sanitizeCss leaves ordinary CSS untouched', () => {
  const css = ':root{--green:#7a1f1f}\n.menu li{padding:1rem}';
  assert.equal(sanitizeCss(css), css);
});
