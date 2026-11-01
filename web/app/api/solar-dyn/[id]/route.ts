import { fetchSolarDyn, OrientationOutsideCoverage } from "../../../../lib/solar-dyn-server";
import type { DynSelection } from "../../../../lib/reviewed-dyn-window";
import type {PositionSelection} from "../../../../../platform/position-selection";
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
    let selection: DynSelection | undefined;
    let controller:PositionSelection|undefined;
    const bytes = await fetchSolarDyn(
      id,
      Number(raw),
      request.signal,
      fetch,
      new URL(request.url).searchParams.get("type") === "ori" ? "ori" : "orb",
      (value) => { selection = value; },
      value=>{controller=value;},
    );
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        ...(controller?{"x-dyn-controller-selection":JSON.stringify(controller)}:{}),
        ...(selection ? {
          "x-dyn-source-sha256": selection.sourceSha256,
          "x-dyn-selection": JSON.stringify({ records: selection.records, coverage: selection.coverage }),
        } : {}),
      },
    });
  } catch (e) {
    return Response.json(
      { error: String(e) },
      {
        status: 502,
        headers: {
          ...(e instanceof OrientationOutsideCoverage ? { "x-dyn-orientation-coverage": JSON.stringify(e.coverage) } : {}),
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
