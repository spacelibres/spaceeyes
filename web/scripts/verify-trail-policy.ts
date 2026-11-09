import { SolarSystemData } from "../../platform/solar-system.ts";
import { eyesTrailPhase } from "../../platform/eyes-trail-policy.ts";
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("docs/evidence/trail-budget-0.0.73", { recursive: true });
const output = [];
const cases = [
  ["sc_mars_2020", 666953098.003],
  ["sc_mars_science_laboratory", 397502386.832],
  ["sc_mars_exploration_rover_1", 128278523],
  ["sc_mars_exploration_rover_2", 126462396],
  ["sc_insight", 596533602],
  ["sc_juno", 519652868.184],
  ["sc_huygens", 158965616.707],
  ["sc_osiris_rex_src", 748838642],
  ["sc_stardust_src", 190591100],
] as const;
for (const [id, t] of cases) {
  for (const epoch of [t - 1, t, t + 1]) {
    const abort = new AbortController();
    const fetched: unknown[] = [];
    const data = new SolarSystemData(
      {
        signal: abort.signal,
        onDispose() {},
        data: { publish() {}, remove() {} },
      } as any,
      {
        fetch: async (input, init) => {
          const url = new URL(String(input), "http://127.0.0.1:3006");
          const r = await fetch(url, {
            ...init,
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
          });
          fetched.push({
            path: url.pathname + url.search,
            status: r.status,
            sha256: r.headers.get("x-dyn-source-sha256"),
          });
          return r;
        },
      },
    );
    try {
      await data.load([id], epoch, [id]);
      const phase = eyesTrailPhase(id, epoch);
      let result: any;
      if (data.hasTrajectory(id, epoch)) {
        const steps = data.trailSampleSteps(id, epoch, 64, true);
        let work = 0;
        let next;
        const at = performance.now();
        do {
          next = steps.next();
          work++;
        } while (!next.done);
        const x = next.value;
        result = {
          points: x.points.length,
          drawRange: x.drawRangeTdbSeconds,
          sourceRange: [x.epochsTdbSeconds[0], x.epochsTdbSeconds.at(-1)],
          origin: x.originId,
          orientation: x.referenceOrientation,
          visibility: x.visibleInterval,
          breaks: x.breakIndices.length,
          duration: x.durationSeconds,
          work,
          wallMs: performance.now() - at,
        };
      }
      output.push({
        id,
        epoch,
        status: data.status(id),
        policy: phase,
        result: result ?? "no trajectory in phase",
        fetched,
      });
      console.log(id, epoch, Boolean(result));
    } catch (error) {
      output.push({ id, epoch, error: String(error), fetched });
      console.log(id, epoch, String(error));
    } finally {
      data.dispose();
      abort.abort();
    }
    await writeFile(
      "docs/evidence/trail-budget-0.0.73/real-policy-boundaries.json",
      JSON.stringify(output, null, 2) + "\n",
    );
  }
}
