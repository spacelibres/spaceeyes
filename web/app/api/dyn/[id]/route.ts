import { fetchDyn } from "../../../../lib/dyn-server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const bytes = await fetchDyn(id, request.signal);
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "content-length": String(bytes.length),
      },
    });
  } catch (error) {
    return Response.json(
      { error: String(error) },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
