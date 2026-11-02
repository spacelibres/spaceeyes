import { eyesAssets } from "../../../../../lib/eyes-assets";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  try {
    const { id, path } = await params;
    if (path.length !== 1)
      return new Response("Unknown resource path", { status: 404 });
    const asset = await eyesAssets.get(id, path[0], request.signal);
    return new Response(asset.bytes as BodyInit, {
      headers: {
        "content-type": asset.mime,
        "cache-control": "private, max-age=3600",
        etag: `"${asset.sha256}"`,
      },
    });
  } catch (error) {
    const message = String(error);
    return Response.json(
      { error: message },
      { status: message.includes("Unknown") ? 404 : 502 },
    );
  }
}
