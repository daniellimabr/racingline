import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, FORBIDDEN_FILE } from '../tools/scan-secrets.mjs';

// Fake secrets are assembled at runtime so this file never matches the scanner itself.
const fake = (prefix, n, ch = 'a') => prefix + ch.repeat(n);

test('detects token-shaped strings', () => {
  for (const [s, rule] of [
    [fake('gh' + 'p_', 36), 'github-token'],
    [fake('github' + '_pat_', 40), 'github-token'],
    [fake('AK' + 'IA', 16, 'A'), 'aws-access-key'],
    ['-----BEGIN RSA ' + 'PRIVATE KEY-----', 'private-key'],
    ['pass' + 'word = "hunter2hunter2"', 'assigned-secret'],
  ]) assert.deepEqual(scanText('x\n' + s), [{ line: 2, rule }], s.slice(0, 8));
});

test('ignores ordinary code', () => {
  assert.deepEqual(scanText('const token = getToken();\nconst password = process.env.X;'), []);
});

test('flags secret-like file names but not examples', () => {
  for (const f of ['.env', 'a/.env.local', 'id_rsa', 'k/server.pem', 'credentials-gcp.json']) assert.ok(FORBIDDEN_FILE.test(f), f);
  for (const f of ['.env.example', 'src/keyboard.js', 'environment.md']) assert.ok(!FORBIDDEN_FILE.test(f), f);
});
