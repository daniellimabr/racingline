// Locks the frozen v24 reference: any byte change fails CI. Port work happens elsewhere (ADR-001).
import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const V24_SHA256 = '2f07c3ae431ddceb055268bfd608b7e624d3005ae31993fbaaf057fa535ee239';

describe('frozen prototype', () => {
  test('prototype-v24.html is byte-identical to the frozen reference', () => {
    const bytes = readFileSync(new URL('../prototype/prototype-v24.html', import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(V24_SHA256);
  });
});
