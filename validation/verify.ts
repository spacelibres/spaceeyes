import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sampleUri, validateDyn, validateGltf, validateKtx2, validatePointCloud } from './resources.ts';

type Artifact = { file: string; kind: string; bytes: number; sha256: string; source: string };
const args = process.argv.slice(2);
const options = new Map<string, string>();
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--samples', '--manifest', '--output'].includes(args[i]) || !args[i + 1] || options.has(args[i])) {
      throw new Error('Usage: node verify.ts --samples DIRECTORY [--manifest FILE] [--output FILE]');
    }
    options.set(args[i], args[i + 1]);
  }
  if (!options.has('--samples')) throw new Error('--samples DIRECTORY is required; no implicit downloads');
  const root = await realpath(resolve(options.get('--samples')!));
  const manifestPath = resolve(options.get('--manifest') ?? fileURLToPath(new URL('manifest.json', import.meta.url)));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0 || manifest.artifacts.length > 100) {
    throw new Error('manifest must contain 1..100 artifacts');
  }
  async function readSample(name: string): Promise<Buffer> {
    sampleUri(name);
    const path = await realpath(resolve(root, name));
    const local = relative(root, path);
    if (local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) {
      throw new Error('sample path escapes directory');
    }
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 16 * 1024 * 1024) throw new Error('sample size limit: 16 MiB');
    return readFile(path);
  }
  const seen = new Set<string>();
  const results = [];
  for (const artifact of manifest.artifacts as Artifact[]) {
    try {
      sampleUri(artifact.file);
      if (seen.has(artifact.file)) throw new Error('duplicate artifact');
      seen.add(artifact.file);
      if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 ||
        !/^[a-f0-9]{64}$/i.test(artifact.sha256) || typeof artifact.source !== 'string') {
        throw new Error('invalid manifest identity');
      }
      const bytes = await readSample(artifact.file);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== artifact.sha256.toLowerCase()) throw new Error('SHA-256 mismatch; investigate before updating manifest');
      if (bytes.length !== artifact.bytes) throw new Error('byte length mismatch');
      let checks: unknown;
      switch (artifact.kind) {
        case 'point-cloud': checks = validatePointCloud(bytes); break;
        case 'ktx2': checks = validateKtx2(bytes); break;
        case 'dyn': checks = validateDyn(bytes); break;
        case 'binary': checks = { scope: 'identity only; content semantics unverified' }; break;
        case 'gltf': {
          const model = JSON.parse(bytes.toString('utf8'));
          const payloads = new Map<string, Buffer>();
          if (!Array.isArray(model.buffers)) throw new Error('glTF buffers must be an array');
          for (const buffer of model.buffers) {
            const uri = sampleUri(buffer.uri);
            // Every binary dependency must have its own pinned identity entry.
            const dependencyName = relative(root, resolve(root, dirname(artifact.file), uri)).replaceAll('\\', '/');
            const identity = (manifest.artifacts as Artifact[]).find(item => item.file === dependencyName);
            if (!identity) throw new Error(`buffer dependency has no manifest identity: ${uri}`);
            const data = await readSample(dependencyName);
            if (data.length !== identity.bytes || createHash('sha256').update(data).digest('hex') !== identity.sha256.toLowerCase()) {
              throw new Error(`buffer dependency SHA-256/length mismatch: ${uri}`);
            }
            payloads.set(uri, data);
          }
          checks = validateGltf(model, payloads);
          break;
        }
        default: throw new Error(`unsupported validation kind: ${artifact.kind}`);
      }
      results.push({ file: artifact.file, source: artifact.source, sha256, passed: true, checks });
    } catch (error) {
      results.push({ file: artifact?.file, passed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const report = { generatedAt: new Date().toISOString(), passed: results.every(item => item.passed),
    scope: 'offline resource contract experiment; not Bevy loading, GPU rendering or scientific certification',
    artifacts: results };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (options.has('--output')) {
    const path = resolve(options.get('--output')!);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output);
  }
  process.stdout.write(output);
  process.exitCode = report.passed ? 0 : 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
