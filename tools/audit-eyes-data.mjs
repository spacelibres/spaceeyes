import fs from "node:fs";
import {
  eyesCatalog,
  getEyesDefinition,
  declaredTracks,
} from "../platform/eyes-catalog.ts";
import { decodeDyn } from "../platform/dyn-decoder.ts";
import { SolarSystemData } from "../platform/solar-system.ts";
import { fetchSolarDyn } from "../web/lib/solar-dyn-server.ts";
const now = 846620500;
const retry = process.argv.includes("--retry-history");
const prior = retry
  ? JSON.parse(
      fs.readFileSync("validation/results/eyes-data-followup-audit.json"),
    )
  : undefined;
const retryIds = new Set(
  prior?.rows
    .filter(
      (r) =>
        r.historical &&
        (r.historical.status !== "ready" || !r.historical.position),
    )
    .map((r) => r.id),
);
const rows = retry ? prior.rows.filter((r) => !retryIds.has(r.id)) : [];
async function sample(id, epoch) {
  const controller = new AbortController();
  const context = {
    signal: controller.signal,
    onDispose() {},
    data: { publish() {}, remove() {} },
  };
  const source = new SolarSystemData(context, {
    fetch: async (input) => {
      const u = new URL(input, "https://local");
      try {
        return new Response(
          await fetchSolarDyn(
            u.pathname.split("/").at(-1),
            Number(u.searchParams.get("epoch")),
            controller.signal,
            fetch,
            u.searchParams.get("type") ?? "orb",
          ),
        );
      } catch (e) {
        return new Response(String(e), {
          status: 422,
          headers: { "x-dyn-error": String(e) },
        });
      }
    },
  });
  try {
    await source.load([id], epoch);
    const status = source.status(id);
    let position, error;
    try {
      position = source.position(id, epoch);
    } catch (e) {
      error = String(e);
    }
    return { epoch, ...status, position, positionError: error };
  } finally {
    source.dispose();
  }
}
const chosen = retry
  ? eyesCatalog.filter((x) => retryIds.has(x.id))
  : process.argv.includes("--affected-only")
    ? eyesCatalog.filter(
        (x) =>
          [
            "sc_cassini",
            "sc_voyager_1",
            "sc_voyager_2",
            "s_2020_s_46",
            "s_2020_s_47",
            "s_2023_s_55",
          ].includes(x.id) ||
          Object.keys(
            JSON.parse(
              fs.readFileSync("web/lib/reviewed-mission-policies.json"),
            ),
          ).some((k) => k.startsWith(x.id + "/")) ||
          [
            "sc_kepler_space_telescope",
            "sc_deep_impact_impactor",
            "sc_trmm",
          ].includes(x.id),
      )
    : eyesCatalog;
for (let i = 0; i < chosen.length; i += 8) {
  await Promise.all(
    chosen.slice(i, i + 8).map(async (target) => {
      const current = await sample(target.id, now);
      let historical;
      if (current.status === "out-of-coverage") {
        const d = getEyesDefinition(target.id);
        const starts = [
          ...(d?.parents ?? []).map((p) => Number(p[0])),
          ...(d?.controllers ?? []).map((c) => Number(c.coverage?.[0])),
        ].filter(Number.isFinite);
        for (const start of starts) {
          historical = await sample(target.id, start + 1);
          if (historical.status === "ready" && historical.position) break;
        }
        if (historical?.status !== "ready")
          for (const track of declaredTracks(target.id)) {
            try {
              const response = await fetch(
                "https://eyes.nasa.gov/assets/dynamic/dynamo/" +
                  track +
                  "/def.dyn",
                { redirect: "error", signal: AbortSignal.timeout(20000) },
              );
              if (!response.ok) continue;
              const data = decodeDyn(
                new Uint8Array(await response.arrayBuffer()),
              );
              historical = await sample(target.id, data.coverage.start + 1);
              if (historical.status === "ready" && historical.position) break;
            } catch {}
          }
      }
      rows.push({ id: target.id, current, historical });
      console.log(
        target.id,
        current.status,
        historical?.status ?? "",
        current.error ?? "",
        historical?.error ?? "",
      );
    }),
  );
}
const counts = {};
for (const r of rows)
  counts[r.current.status] = (counts[r.current.status] ?? 0) + 1;
fs.writeFileSync(
  "validation/results/eyes-data-followup-audit.json",
  JSON.stringify({ epoch: now, counts, rows }, null, 2),
);
