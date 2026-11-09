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

import phases from "./eyes-trail-phases.json" with { type: "json" };
export type EyesTrailPhase = Readonly<{
  key: string;
  startTime?: number;
  endTime: number;
  relativeStartTime: boolean;
  relativeEndTime: boolean;
  startTimeMultiplier: number;
  endTimeMultiplier: number;
  relativeToEntity: string;
  relativeToEntityOrientation: boolean;
  visibleInterval: "AlwaysVisible" | "DefaultVisibleFar";
}>;
const phaseCache = new Map<string, EyesTrailPhase>();
const boundaryCache = new Map<string, readonly number[]>();
export function eyesTrailBoundaries(id: string): readonly number[] {
  let result = boundaryCache.get(id);
  if (!result) {
    result = Object.freeze(
      [
        ...new Set(
          [
            ...(getEyesDefinition(id)?.trail?.lengthCoverages ?? []).flatMap(
              (x: unknown[]) => [Number(x[1]), Number(x[2])],
            ),
            ...phases.slots
              .filter((x) => x.entity === id)
              .flatMap((x) => x.coverage.map(Number)),
          ].filter(Number.isFinite),
        ),
      ].sort((a, b) => a - b),
    );
    boundaryCache.set(id, result);
  }
  return result;
}
/** Pure seek evaluation: reset defaults, then all inactive exits, then active enters. */
export function eyesTrailPhase(id: string, epoch: number): EyesTrailPhase {
  if (!Number.isFinite(epoch)) throw new Error("Trail epoch must be finite");
  const trail = getEyesDefinition(id)?.trail;
  const state = {
    startTime: eyesTrailDuration(id, epoch),
    endTime: 0,
    relativeStartTime: true,
    relativeEndTime: true,
    startTimeMultiplier: 1,
    endTimeMultiplier: 1,
    relativeToEntity: trail?.relativeTo ?? "",
    relativeToEntityOrientation:
      trail?.relativeTo === undefined
        ? (trail?.relativeToOrientation ?? false)
        : false,
    visibleInterval: "DefaultVisibleFar" as EyesTrailPhase["visibleInterval"],
  };
  const slots = phases.slots
    .filter((x) => x.entity === id)
    .sort((a, b) => a.controllerIndex - b.controllerIndex);
  for (const phase of ["exit", "enter"])
    for (const slot of slots) {
      const active =
        epoch >= Number(slot.coverage[0]) && epoch <= Number(slot.coverage[1]);
      if (slot.phase === phase && active === (phase === "enter"))
        Object.assign(state, slot.patch);
    }
  const key = JSON.stringify([id, state]);
  let result = phaseCache.get(key);
  if (!result) {
    result = Object.freeze({ ...state, key });
    phaseCache.set(key, result);
  }
  return result;
}
