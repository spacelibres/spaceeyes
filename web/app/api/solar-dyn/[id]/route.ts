import { fetchSolarDyn } from "../../../../lib/solar-dyn-server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } = await context.params;
    const raw = new URL(request.url).searchParams.get("epoch");
    if (raw === null)
      return Response.json({ error: "epoch required" }, { status: 400 });
    const bytes = await fetchSolarDyn(
      id,
      Number(raw),
      request.signal,
      fetch,
      new URL(request.url).searchParams.get("type") === "ori" ? "ori" : "orb",
    );
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return Response.json(
      { error: String(e) },
      {
        status: 502,
        headers: {
          "x-dyn-error": String(e).includes("sample times must increase")
            ? "sample times must increase"
            : String(e).includes("Outside source coverage")
              ? "Outside source coverage"
              : "source unavailable",
        },
      },
    );
  }
}
