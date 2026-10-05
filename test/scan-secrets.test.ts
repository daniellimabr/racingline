import { expect, test } from 'vitest';
import { scanText, FORBIDDEN_FILE } from '../tools/scan-secrets.mjs';

// Fake secrets are assembled at runtime so this file never matches the scanner itself.
const fake = (prefix: string, n: number, ch = 'a') => prefix + ch.repeat(n);

test('detects token-shaped strings', () => {
  const cases: Array<[string, string]> = [
    [fake('gh' + 'p_', 36), 'github-token'],
    [fake('github' + '_pat_', 40), 'github-token'],
    [fake('AK' + 'IA', 16, 'A'), 'aws-access-key'],
    ['-----BEGIN RSA ' + 'PRIVATE KEY-----', 'private-key'],
    ['pass' + 'word = "hunter2hunter2"', 'assigned-secret'],
  ];
  for (const [s, rule] of cases) expect(scanText('x\n' + s), s.slice(0, 8)).toEqual([{ line: 2, rule }]);
});

test('ignores ordinary code', () => {
  expect(scanText('const token = getToken();\nconst password = process.env.X;')).toEqual([]);
});

test('flags secret-like file names but not examples', () => {
  for (const f of ['.env', 'a/.env.local', 'id_rsa', 'k/server.pem', 'credentials-gcp.json']) expect(FORBIDDEN_FILE.test(f), f).toBe(true);
  for (const f of ['.env.example', 'src/keyboard.js', 'environment.md']) expect(FORBIDDEN_FILE.test(f), f).toBe(false);
});
