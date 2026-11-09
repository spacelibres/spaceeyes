import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { sendBufferedResourceResponse } from "./buffered-resource-response.ts";

test("binary responses preserve headers, status and bytes in one completed response", async () => {
  const bytes = Uint8Array.from({ length: 400_000 }, (_, i) => i % 251);
  const server = createServer(async (request, response) => {
    const source = request.url === "/missing"
      ? new Response("missing", { status: 404, headers: { "cache-control": "no-store" } })
      : new Response(bytes, { headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=3600" } });
    await sendBufferedResourceResponse(response, source, request.method ?? "GET");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const result = await fetch(base);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
    const head = await fetch(base, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const missing = await fetch(`${base}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.equal(await missing.text(), "missing");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
