import type { ServerResponse } from "node:http";

/** Send a fully prepared bounded resource without flushing its headers separately. */
export async function sendBufferedResourceResponse(
  target: ServerResponse,
  source: Response,
  method: string,
): Promise<void> {
  const body = method === "HEAD" ? undefined : Buffer.from(await source.arrayBuffer());
  if (target.destroyed || target.writableEnded) return;
  target.statusCode = source.status;
  source.headers.forEach((value, key) => target.setHeader(key, value));
  target.end(body);
}
