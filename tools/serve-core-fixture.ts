// Serves only the explicit verification fixture and its generated WASM, never the workspace.
import { createFixtureServer } from './fixture-server.ts';
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
const server = await createFixtureServer();
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') process.stdout.write(`Core fixture: http://127.0.0.1:${address.port}/\n`);
});
