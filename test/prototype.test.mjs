// Locks the frozen v24 reference: any byte change fails CI. Port work happens elsewhere (ADR-001).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const V24_SHA256 = '2f07c3ae431ddceb055268bfd608b7e624d3005ae31993fbaaf057fa535ee239';

test('prototype-v24.html is byte-identical to the frozen reference', () => {
  const bytes = readFileSync(new URL('../prototype/prototype-v24.html', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), V24_SHA256);
});
