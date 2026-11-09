import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWebhook } from '../receiver.mjs';
import { deploymentSignature } from '../protocol.mjs';

test('webhook accepts only signed current-main content and removes temporary uploads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spaceeyes-webhook-'));
  const secret = Buffer.alloc(32, 8), commit = 'a'.repeat(40), payload = Buffer.from('archive');
  const deployed = [];
  const server = createWebhook({ secret, incoming: root, maxBytes: 32,
    head: async () => commit,
    deploy: async (sha, path) => deployed.push([sha, (await readFile(path)).toString()]) });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/deploy`;
    const post = (body, sha, signature) => fetch(url, { method: 'POST', body, headers: { 'x-spaceeyes-sha': sha, 'x-spaceeyes-signature': signature } });
    let response = await post(payload, commit, deploymentSignature(secret, commit, payload));
    assert.equal(response.status, 200);
    assert.deepEqual(deployed, [[commit, 'archive']]);
    response = await post(Buffer.from('changed'), commit, deploymentSignature(secret, commit, payload));
    assert.equal(response.status, 401);
    const stale = 'b'.repeat(40);
    response = await post(payload, stale, deploymentSignature(secret, stale, payload));
    assert.equal(response.status, 409);
    response = await post(Buffer.alloc(33), commit, deploymentSignature(secret, commit, Buffer.alloc(33)));
    assert.equal(response.status, 413);
    assert.equal(deployed.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
