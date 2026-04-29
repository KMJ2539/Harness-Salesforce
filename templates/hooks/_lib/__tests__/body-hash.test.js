'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bodyHash, stripped } = require('../state/body-hash');

test('hash is stable across review/resolution edits', () => {
  const baseBody = `# Title

## Why
because.
`;
  const a = `---
type: apex
name: x
---

${baseBody}
## Reviews
none
`;
  const b = `---
type: apex
name: x
---

${baseBody}
## Reviews
fully populated by codex round 3 with 8 H findings
`;
  assert.equal(bodyHash(a), bodyHash(b), 'hash should ignore ## Reviews');
});

test('hash changes when substantive body changes', () => {
  const a = `---
type: apex
name: x
---
# Title
## Why
A.
`;
  const b = `---
type: apex
name: x
---
# Title
## Why
B.
`;
  assert.notEqual(bodyHash(a), bodyHash(b));
});

test('hash ignores ## Resolution and ## Review Resolution', () => {
  const baseBody = `# T\n## Why\nbecause.\n`;
  const a = `---
type: apex
name: x
---
${baseBody}
## Resolution
nothing yet
`;
  const b = `---
type: apex
name: x
---
${baseBody}
## Review Resolution
H1: accept
H2: reject
`;
  assert.equal(bodyHash(a), bodyHash(b));
});

test('CRLF normalized — same as LF', () => {
  const lf = `---\ntype: apex\nname: x\n---\n# T\n`;
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(bodyHash(lf), bodyHash(crlf));
});

test('stripped removes Reviews/Resolution but keeps body', () => {
  const text = `---
type: apex
name: x
---
# Title

body text

## Reviews
remove me

## What
keep me
`;
  const out = stripped(text);
  assert.match(out, /body text/);
  assert.match(out, /## What/);
  assert.doesNotMatch(out, /remove me/);
});
