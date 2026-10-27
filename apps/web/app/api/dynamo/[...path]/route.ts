// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import { NextResponse } from "next/server";

const DYNAMO_ORIGIN = "https://eyes.nasa.gov/assets/dynamic/dynamo";
const MAX_BYTES = 16 * 1024 * 1024;
const PATH_PATTERN =
  /^[a-z0-9_]+(?:\/[a-z0-9_]+){1,5}\/(?:orb|pos|lin|ori|quat)\/(?:def|\d{1,9})\.dyn$/;

/**
 * Read-only NASA DYN proxy. Only allowlisted controller paths are fetched, no
 * source data is cached, and responses larger than the upload ceiling are
 * rejected. Licensing for redistribution is still unconfirmed, so the route
 * must not become a general-purpose mirror.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const joined = path.join("/");
  if (!PATH_PATTERN.test(joined) || joined.includes("..")) {
    return new NextResponse("invalid dynamo path", { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${DYNAMO_ORIGIN}/${joined}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new NextResponse("dynamo upstream unavailable", { status: 502 });
  }
  if (!upstream.ok) {
    return new NextResponse(`dynamo upstream status ${upstream.status}`, {
      status: 502,
    });
  }
  const length = Number(upstream.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    return new NextResponse("dynamo response too large", { status: 413 });
  }
  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
    return new NextResponse("invalid dynamo response size", { status: 502 });
  }
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
      "content-length": String(body.byteLength),
    },
  });
}
