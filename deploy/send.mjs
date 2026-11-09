import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createDeploymentHmac, validCommit } from './protocol.mjs';

const [file, sha] = process.argv.slice(2);
const secret = process.env.SPACEEYES_DEPLOY_SECRET ?? '';
if (!file || !validCommit(sha) || !/^[a-f0-9]{64}$/.test(secret)) throw Error('Invalid deployment sender configuration');
const { size } = await stat(file);
if (!Number.isSafeInteger(size) || size < 1 || size > 256 * 1024 * 1024) throw Error('Deployment package exceeds budget');
const hmac = createDeploymentHmac(Buffer.from(secret, 'hex'), sha);
for await (const chunk of createReadStream(file)) hmac.update(chunk);
const signature = 'sha256=' + hmac.digest('hex');
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch('https://www.spaceeyes.cn/_spaceeyes/deploy', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000), duplex: 'half',
    headers: { 'content-type': 'application/octet-stream', 'content-length': String(size),
      'x-spaceeyes-sha': sha, 'x-spaceeyes-signature': signature },
    body: createReadStream(file),
  });
  const text = await response.text();
  if (response.ok) { console.log(`Deployment accepted for ${sha}`); process.exit(0); }
  if (response.status === 409 && text === 'not current main') {
    console.log(`Skipped superseded commit ${sha}`); process.exit(0);
  }
  if (response.status === 409 && text === 'deployment busy' && attempt < 11) {
    await new Promise(resolve => setTimeout(resolve, 15000)); continue;
  }
  throw Error(`Deployment webhook HTTP ${response.status}: ${text.slice(0, 300)}`);
}
