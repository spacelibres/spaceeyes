type Segment = { a: number; b: number; score: number; terminal: boolean };
/** Refine curvature rather than shortening source-authored history. */
export function* adaptiveTrailSteps(
  start: number,
  epoch: number,
  end: number,
  count: number,
  position: (time: number) => readonly number[],
  period?: number,
  boundaries: readonly number[] = [],
  observer?: readonly number[],
): Generator<void, { times: number[]; unresolved: Set<number> }> {
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
  if(observer && (observer.length!==3 || !observer.every(Number.isFinite)))
    throw Error("Invalid trail observer");
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
  const evaluate = function* (a: number, b: number): Generator<void, Segment> {
    const points: (readonly number[] | undefined)[] = [];
    for (let i = 0; i <= 8; i++) {
      yield;
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
    // The camera can graze the interior of a chord while all nine probes are
    // distant. Endpoint distances then underestimate its projected error.
    let observerDistance: number | undefined;
    if (observer) {
      const delta=q.map((x,k)=>x-p[k]);
      const length2=delta.reduce((sum,x)=>sum+x*x,0);
      const u=length2>0 ? Math.max(0,Math.min(1,delta.reduce((sum,x,k)=>sum+x*(observer[k]-p[k]),0)/length2)) : 0;
      observerDistance=Math.max(1e-6,Math.hypot(...p.map((x,k)=>x+u*delta[k]-observer[k])));
    }
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
      if(observerDistance !== undefined) {
        const deviation=Math.hypot(...v.map((x,k)=>x-(p[k]+((q[k]-p[k])*i)/8)));
        error=Math.max(error,deviation/(observerDistance*0.0005));
      }
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
  const required = [
    ...new Set([
      start,
      epoch,
      end,
      ...boundaries.filter((t) => Number.isFinite(t) && t > start && t < end),
    ]),
  ];
  if (required.length > count) throw Error("History boundary sample budget");
  const seeds = Math.min(
    Math.max(1, count - required.length + 1),
    Math.max(
      8,
      Math.min(64, Math.ceil(((end - start) / (period || Infinity)) * 4)),
    ),
  );
  let times = [
    ...new Set([
      ...required,
      ...Array.from(
        { length: seeds + 1 },
        (_, i) => start + ((end - start) * i) / seeds,
      ),
    ]),
  ].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 1; i < times.length; i++)
    segments.push(yield* evaluate(times[i - 1], times[i]));
  while (times.length < count) {
    let index = -1;
    for (let i = 0; i < segments.length; i++) {
      if(i % 64 === 0) yield;
      if (
        !segments[i].terminal &&
        segments[i].score > 1 &&
        (index < 0 || segments[i].score > segments[index].score)
      )
        index = i;
    }
    if (index < 0) break;
    const s = segments[index],
      mid = (s.a + s.b) / 2;
    if (mid === s.a || mid === s.b) {
      s.terminal = true;
      continue;
    }
    segments.splice(
      index,
      1,
      yield* evaluate(s.a, mid),
      yield* evaluate(mid, s.b),
    );
    times.push(mid);
  }
  times.sort((a, b) => a - b);
  const bad = [...failures].sort((a, b) => a - b),
    unresolved = new Set<number>();
  let failure = 0;
  for (const s of segments) {
    yield;
    while (failure < bad.length && bad[failure] < s.a) failure++;
    // Exhausted geometric refinement is an approximation, not a source gap.
    // Keep the best covered polyline; only missing source data breaks it.
    if (failure < bad.length && bad[failure] <= s.b) unresolved.add(s.b);
  }
  return { times, unresolved };
}

/** Synchronous compatibility API with exactly the same refinement algorithm. */
export function adaptiveTrailTimes(
  ...args: Parameters<typeof adaptiveTrailSteps>
) {
  const work = adaptiveTrailSteps(...args);
  let result = work.next();
  while (!result.done) result = work.next();
  return result.value;
}
