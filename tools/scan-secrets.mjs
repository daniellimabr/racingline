#!/usr/bin/env node
// Secret scanner. Zero dependencies.
//   node tools/scan-secrets.mjs --staged   (pre-commit: scans staged content)
//   node tools/scan-secrets.mjs --all      (CI: scans every tracked file)
// Exit 1 and print file:line + rule (never the matched value) when something is found.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RULES = [
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['slack-token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['assigned-secret', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
];

export const FORBIDDEN_FILE = /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|[^/]*\.(?:pem|key|p12|pfx|ppk)|credentials[^/]*\.json)$/i;

export function scanText(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [rule, re] of RULES) if (re.test(line)) hits.push({ line: i + 1, rule });
  });
  return hits;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20 });

function main(mode) {
  const staged = mode === '--staged';
  const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files'))
    .split('\n').filter(Boolean);
  const problems = [];
  for (const f of files) {
    if (FORBIDDEN_FILE.test(f)) { problems.push(`${f}: forbidden file type`); continue; }
    let text;
    try { text = staged ? git('show', `:${f}`) : readFileSync(f, 'utf8'); }
    catch { continue; } // deleted between listing and read
    if (text.includes('\0')) continue; // binary
    for (const h of scanText(text)) problems.push(`${f}:${h.line}: ${h.rule}`);
  }
  if (problems.length) {
    console.error('Secret scan FAILED (values not shown):\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`Secret scan OK (${files.length} files).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--all') {
    console.error('usage: scan-secrets.mjs --staged | --all');
    process.exit(2);
  }
  main(mode);
}
