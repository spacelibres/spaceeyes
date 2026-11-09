import { createHmac, timingSafeEqual } from 'node:crypto';

export function validCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

export function createDeploymentHmac(secret, commit) {
  if (!Buffer.isBuffer(secret) || secret.length < 32 || !validCommit(commit))
    throw new Error('Invalid deployment identity');
  return createHmac('sha256', secret).update(commit + '\n');
}

export function deploymentSignature(secret, commit, bytes) {
  return 'sha256=' + createDeploymentHmac(secret, commit).update(bytes).digest('hex');
}

export function validDeploymentSignature(secret, commit, bytes, supplied) {
  if (!validCommit(commit) || typeof supplied !== 'string' || !/^sha256=[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = Buffer.from(deploymentSignature(secret, commit, bytes));
  return timingSafeEqual(expected, Buffer.from(supplied));
}
