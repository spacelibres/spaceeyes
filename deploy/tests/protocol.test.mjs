import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { deploymentSignature, validDeploymentSignature, validCommit } from '../protocol.mjs';

const secret = Buffer.alloc(32, 7);
const commit = 'a'.repeat(40);
const archive = Buffer.from('release payload');

test('signature binds commit and all archive bytes', () => {
  const signature = deploymentSignature(secret, commit, archive);
  assert.equal(signature, 'sha256=' + createHmac('sha256', secret).update(commit + '\n').update(archive).digest('hex'));
  assert.equal(validDeploymentSignature(secret, commit, archive, signature), true);
  assert.equal(validDeploymentSignature(secret, 'b'.repeat(40), archive, signature), false);
  assert.equal(validDeploymentSignature(secret, commit, Buffer.from('changed'), signature), false);
  assert.equal(validDeploymentSignature(secret, commit, archive, 'sha256=xyz'), false);
});

test('only lowercase full git SHA values are accepted', () => {
  assert.equal(validCommit(commit), true);
  for (const value of ['a'.repeat(39), 'A'.repeat(40), '../main', '', '0'.repeat(41)])
    assert.equal(validCommit(value), false);
});
