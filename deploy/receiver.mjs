import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createDeploymentHmac, validCommit } from './protocol.mjs';

export function createWebhook({ secret, incoming, head, deploy, maxBytes = 256 * 1024 * 1024 }) {
  if (!Buffer.isBuffer(secret) || secret.length < 32 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('Invalid webhook configuration');
  let busy = false;
  return createServer(async (req, res) => {
    const respond = (status, message) => { if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end(message); };
    if (req.method === 'GET' && req.url === '/healthz') return respond(200, 'ok');
    if (req.method !== 'POST' || req.url !== '/deploy') return respond(404, 'not found');
    const sha = req.headers['x-spaceeyes-sha'], signature = req.headers['x-spaceeyes-signature'];
    const length = Number(req.headers['content-length']);
    if (!validCommit(sha) || typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(signature)) return respond(401, 'invalid identity');
    if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes) return respond(413, 'invalid size');
    if (busy) return respond(409, 'deployment busy');
    busy = true;
    let path;
    try {
      await mkdir(incoming, { recursive: true, mode: 0o700 });
      path = join(incoming, `${randomUUID()}.tar.gz`);
      const hmac = createDeploymentHmac(secret, sha); let bytes = 0;
      const checksum = new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes || bytes > length) return done(Error('upload budget exceeded'));
        hmac.update(chunk); done(null, chunk);
      } });
      await pipeline(req, checksum, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      const actual = Buffer.from('sha256=' + hmac.digest('hex'));
      if (bytes !== length || !timingSafeEqual(actual, Buffer.from(signature))) return respond(401, 'invalid signature');
      if (await head() !== sha) return respond(409, 'not current main');
      await deploy(sha, path);
      return respond(200, 'deployed');
    } catch (error) {
      console.error('Deployment failed:', error instanceof Error ? error.message : String(error));
      if (!res.destroyed) respond(500, 'deployment failed');
    } finally {
      if (path) await rm(path, { force: true }).catch(() => {});
      busy = false;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const secretText = (await readFile(process.env.SPACEEYES_WEBHOOK_SECRET_FILE ?? '/etc/spaceeyes/webhook.secret', 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secretText)) throw Error('Invalid webhook secret');
  const run = promisify(execFile);
  const root = process.env.SPACEEYES_DEPLOY_ROOT ?? '/opt/spaceeyes';
  const server = createWebhook({ secret: Buffer.from(secretText, 'hex'), incoming: join(root, 'incoming'),
    head: async () => {
      const response = await fetch('https://api.github.com/repos/spacelibres/spaceeyes/commits/main', {
        headers: { 'user-agent': 'spaceeyes-vps-deployment', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error('GitHub main verification unavailable');
      const value = await response.json();
      return validCommit(value.sha) ? value.sha : '';
    },
    deploy: async (sha, file) => { await run('/opt/spaceeyes/bin/deploy-release.sh', [sha, file], { timeout: 180000, maxBuffer: 65536 }); },
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 15000;
  server.listen(9876, '127.0.0.1', () => console.log('SpaceEyes deployment webhook listening on loopback'));
}
