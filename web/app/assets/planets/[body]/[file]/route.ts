import { planetTexture } from "../../../../../lib/planet-texture-server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ body: string; file: string }> },
) {
  try {
    const { body, file } = await context.params;
    const bytes = await planetTexture(body, file, request.signal);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": file.endsWith(".jpg") ? "image/jpeg" : "image/png",
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: String(error).includes("Unknown") ? 404 : 502, headers: { "cache-control": "no-store" } },
    );
  }
}
