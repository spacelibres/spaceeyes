import literals from "./eyes-position-keyframes.json" with { type: "json" };
import { getEyesDefinition } from "./eyes-catalog.ts";
/** Reviewed source KeyframeController Hermite positions/derivatives. No source evaluation. */
export function eyesPositionKeyframe(id: string, t: number) {
  if (id !== literals.entity || !Number.isFinite(t)) return;
  let result:
    | {
        referenceId: string;
        position: [number, number, number];
        velocity: [number, number, number];
        coverage: [number, number];
        source: string;
      }
    | undefined;
  for (const controller of getEyesDefinition(id)?.controllers ?? []) {
    const rule = literals.controllers.find(
      (x) => x.sourceSha256 === controller.func?.sourceSha256,
    );
    if (!rule) continue;
    const r = rule.records;
    if (t < r[0][0] || t > r.at(-1)![0]) continue;
    const right = Math.max(
      1,
      r.findIndex((x) => x[0] >= t),
    );
    const i = right - 1,
      a = r[i],
      b = r[right],
      dt = b[0] - a[0],
      u = (t - a[0]) / dt;
    const m0 = a
      .slice(1)
      .map((x, k) =>
        i === 0
          ? b[k + 1] - x
          : 0.5 * (b[k + 1] - x) +
            ((0.5 * dt) / (a[0] - r[i - 1][0])) * (x - r[i - 1][k + 1]),
      );
    const m1 = a
      .slice(1)
      .map((x, k) =>
        right === r.length - 1
          ? b[k + 1] - x
          : 0.5 * (b[k + 1] - x) +
            ((0.5 * dt) / (r[right + 1][0] - b[0])) *
              (r[right + 1][k + 1] - b[k + 1]),
      );
    const weights = [
      2 * u ** 3 - 3 * u * u + 1,
      u ** 3 - 2 * u * u + u,
      -2 * u ** 3 + 3 * u * u,
      u ** 3 - u * u,
    ];
    const derivative = [
      6 * u * u - 6 * u,
      3 * u * u - 4 * u + 1,
      -6 * u * u + 6 * u,
      3 * u * u - 2 * u,
    ];
    const value = (w: number[], scale = 1) =>
      a
        .slice(1)
        .map(
          (x, k) =>
            (w[0] * x + w[1] * m0[k] + w[2] * b[k + 1] + w[3] * m1[k]) / scale,
        ) as [number, number, number];
    result = {
      referenceId: literals.referenceId,
      position: value(weights),
      velocity: value(derivative, dt),
      coverage: [r[0][0], r.at(-1)![0]],
      source: "NASA reviewed position keyframes " + rule.sourceSha256,
    };
  }
  return result;
}
