import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureServer } from '../../tools/fixture-server.ts';

test('fixture server streams exact lengths, supports HEAD and exposes no workspace paths', async () => {
  const server = await createFixtureServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(base);
    const content = await response.arrayBuffer();
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get('content-length')), content.byteLength);
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get('content-length'), String(content.byteLength));
    assert.equal((await fetch(`${base}/.git/config`)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
