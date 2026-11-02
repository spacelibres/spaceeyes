import { planetTexture } from "../../../../lib/planet-texture-server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ file: string }> },
) {
  try {
    const { file } = await context.params;
    const bytes = await planetTexture("rings", file, request.signal);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: String(error).includes("Unknown") ? 404 : 502 },
    );
  }
}
