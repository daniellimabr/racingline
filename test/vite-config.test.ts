// Hard rule 6 (local-first): the dev and preview servers bind to 127.0.0.1 only.
import { afterEach, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import config from '../vite.config.ts';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
let server: ViteDevServer | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

test('config pins dev and preview servers to 127.0.0.1', () => {
  expect(config.server?.host).toBe('127.0.0.1');
  expect(config.preview?.host).toBe('127.0.0.1');
});

test('a running dev server listens on 127.0.0.1 only', async () => {
  // Only the port is overridden (0 = any free port); the host comes from the real config file.
  server = await createServer({ configFile, logLevel: 'silent', server: { port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo | null;
  expect(address?.address).toBe('127.0.0.1');
});
