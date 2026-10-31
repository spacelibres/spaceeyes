type Segment = { a: number; b: number; score: number; terminal: boolean };
/** Refine curvature rather than shortening source-authored history. */
export function adaptiveTrailTimes(
  start: number,
  epoch: number,
  end: number,
  count: number,
  position: (time: number) => readonly number[],
  period?: number,
): { times: number[]; unresolved: Set<number> } {
  if (
    !Number.isInteger(count) ||
    count < 8 ||
    count > 4096 ||
    ![start, epoch, end].every(Number.isFinite) ||
    start > epoch ||
    epoch > end ||
    start === end
  )
    throw Error("Invalid adaptive trail window");
  const cache = new Map<number, readonly number[] | undefined>();
  const failures = new Set<number>();
  const sample = (t: number) => {
    if (cache.has(t)) {
      const p = cache.get(t);
      if (!p) throw Error("Source gap");
      return p;
    }
    try {
      const p = position(t);
      if (p.length !== 3 || !p.every(Number.isFinite))
        throw Error("Invalid source point");
      cache.set(t, p);
      return p;
    } catch (error) {
      cache.set(t, undefined);
      failures.add(t);
      throw error;
    }
  };
  const evaluate = (a: number, b: number): Segment => {
    const points: (readonly number[] | undefined)[] = [];
    for (let i = 0; i <= 8; i++) {
      try {
        points.push(sample(a + ((b - a) * i) / 8));
      } catch {
        points.push(undefined);
      }
    }
    const valid = points.filter((p) => p !== undefined).length;
    if (valid !== 9)
      return {
        a,
        b,
        score: Infinity,
        terminal: valid === 0 || b - a <= (end - start) / 1e6,
      };
    const p = points[0]!,
      q = points[8]!;
    let error = 0,
      turn = 0,
      previous: number[] | undefined;
    for (let i = 0; i <= 8; i++) {
      const v = points[i]!;
      const radius = Math.max(
        1e-12,
        Math.min(Math.hypot(...p), Math.hypot(...q), Math.hypot(...v)),
      );
      error = Math.max(
        error,
        Math.hypot(...v.map((x, k) => x - (p[k] + ((q[k] - p[k]) * i) / 8))) /
          (radius * 0.001),
      );
      if (i) {
        const delta = v.map((x, k) => x - points[i - 1]![k]);
        const norm = Math.hypot(...delta);
        if (norm > 1e-12) {
          const tangent = delta.map((x) => x / norm);
          if (previous)
            turn += Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  tangent.reduce((sum, x, k) => sum + x * previous![k], 0),
                ),
              ),
            );
          previous = tangent;
        }
      }
    }
    return {
      a,
      b,
      score: Math.max(error, turn / (Math.PI / 60)),
      terminal: false,
    };
  };
  const seeds = Math.min(
    count - 2,
    Math.max(
      8,
      Math.min(64, Math.ceil(((end - start) / (period || Infinity)) * 4)),
    ),
  );
  let times = [
    ...new Set([
      epoch,
      ...Array.from(
        { length: seeds + 1 },
        (_, i) => start + ((end - start) * i) / seeds,
      ),
    ]),
  ].sort((a, b) => a - b);
  const segments = times.slice(1).map((b, i) => evaluate(times[i], b));
  while (times.length < count) {
    let index = -1;
    for (let i = 0; i < segments.length; i++)
      if (
        !segments[i].terminal &&
        segments[i].score > 1 &&
        (index < 0 || segments[i].score > segments[index].score)
      )
        index = i;
    if (index < 0) break;
    const s = segments[index],
      mid = (s.a + s.b) / 2;
    if (mid === s.a || mid === s.b) {
      s.terminal = true;
      continue;
    }
    segments.splice(index, 1, evaluate(s.a, mid), evaluate(mid, s.b));
    times.push(mid);
  }
  times.sort((a, b) => a - b);
  const bad = [...failures].sort((a, b) => a - b),
    unresolved = new Set<number>();
  let failure = 0;
  for (const s of segments) {
    while (failure < bad.length && bad[failure] < s.a) failure++;
    // Exhausted geometric refinement is an approximation, not a source gap.
    // Keep the best covered polyline; only missing source data breaks it.
    if (failure < bad.length && bad[failure] <= s.b)
      unresolved.add(s.b);
  }
  return { times, unresolved };
}
