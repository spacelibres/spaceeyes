import { readGalaxyManifest } from "../../../lib/galaxy-hdr-server.ts";
export const runtime = "nodejs";
export async function GET() {
  try {
    return Response.json(await readGalaxyManifest(), {
      headers: { "Cache-Control": "no-cache" },
    });
  } catch {
    return Response.json(
      { error: "Galaxy resources require offline preparation" },
      { status: 503 },
    );
  }
}
