import { getEyesDefinition } from "./eyes-catalog.ts";
/** Largest explicit window in the captured NASA catalog: Voyager, 30 x 365 days. */
import { MAX_TRAIL_DURATION_SECONDS } from "./trajectory-contract.ts";
export function eyesTrailDuration(
  id: string,
  epoch: number,
): number | undefined {
  const trail = getEyesDefinition(id)?.trail;
  if (!trail) return undefined;
  let value = trail.length;
  for (const coverage of trail.lengthCoverages ?? []) {
    if (epoch >= Number(coverage[1]) && epoch <= Number(coverage[2]))
      value = coverage[0];
  }
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TRAIL_DURATION_SECONDS
    ? value
    : undefined;
}

export function eyesTrailNextBoundary(id: string, epoch: number): number {
  const boundaries = (
    getEyesDefinition(id)?.trail?.lengthCoverages ?? []
  ).flatMap((entry: unknown[]) => [Number(entry[1]), Number(entry[2])]);
  return Math.min(
    Infinity,
    ...boundaries.filter((t: number) => Number.isFinite(t) && t > epoch),
  );
}
