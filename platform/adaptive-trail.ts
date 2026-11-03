type Segment = { a: number; b: number; score: number; terminal: boolean };
/** Retained scientific samples and certified intervals for a moving trail window.
 * The owner must replace this state whenever its source or reference frame changes. */
export class AdaptiveTrailState {
  samples = new Map<number, readonly number[] | undefined>();
  segments = new Map<string, Segment>();
  times: number[] = [];
  observerKey = "";
  covers(time: number) {
    for(const segment of this.segments.values())if(segment.a<=time && time<=segment.b)return true;
    return false;
  }
}
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
  retained?: AdaptiveTrailState,
  reuseCertifiedHead = false,
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
  const headCovered = reuseCertifiedHead && !!retained && retained.covers(epoch);
  const observerKey = JSON.stringify(observer ?? []);
  const observerChanged = !!retained && retained.observerKey !== observerKey;
  if (observerChanged && retained) {
    retained.segments.clear();
    retained.observerKey = observerKey;
  }
  const cache = retained?.samples ?? new Map<number, readonly number[] | undefined>();
  for (const t of cache.keys()) if (t < start || t > end) cache.delete(t);
  const failures = new Set<number>();
  const sample = (t: number) => {
    if (cache.has(t)) {
      const p = cache.get(t);
      if (!p) failures.add(t);
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
    const saved = retained?.segments.get(`${a}:${b}`);
    if (saved) return saved;
    // Re-certify every observer probe, sharing one bounded step for cache hits.
    yield;
    const points: (readonly number[] | undefined)[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = a + ((b - a) * i) / 8;
      if (!cache.has(t)) yield;
      try {
        points.push(sample(t));
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
    // Scalar arithmetic keeps the exact nine-probe error and turning tests
    // without allocating temporary vectors for every retained interval.
    const dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2];
    let observerDistance: number | undefined;
    if(observer) {
      const length2=dx*dx+dy*dy+dz*dz;
      const u=length2>0?Math.max(0,Math.min(1,(dx*(observer[0]-p[0])+dy*(observer[1]-p[1])+dz*(observer[2]-p[2]))/length2)):0;
      observerDistance=Math.max(1e-6,Math.hypot(p[0]+u*dx-observer[0],p[1]+u*dy-observer[1],p[2]+u*dz-observer[2]));
    }
    let error=0,turn=0,previousX=0,previousY=0,previousZ=0,hasPrevious=false;
    const endpointRadius=Math.min(Math.hypot(p[0],p[1],p[2]),Math.hypot(q[0],q[1],q[2]));
    for(let i=0;i<=8;i++) {
      const v=points[i]!;
      const radius=Math.max(1e-12,Math.min(endpointRadius,Math.hypot(v[0],v[1],v[2])));
      const fraction=i/8;
      const deviation=Math.hypot(v[0]-(p[0]+dx*fraction),v[1]-(p[1]+dy*fraction),v[2]-(p[2]+dz*fraction));
      error=Math.max(error,deviation/(radius*.001));
      if(observerDistance!==undefined)error=Math.max(error,deviation/(observerDistance*.0005));
      if(i) {
        const prior=points[i-1]!;
        const x=v[0]-prior[0],y=v[1]-prior[1],z=v[2]-prior[2];
        const norm=Math.hypot(x,y,z);
        if(norm>1e-12) {
          const tx=x/norm,ty=y/norm,tz=z/norm;
          if(hasPrevious)turn+=Math.acos(Math.max(-1,Math.min(1,tx*previousX+ty*previousY+tz*previousZ)));
          previousX=tx;previousY=ty;previousZ=tz;hasPrevious=true;
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
      ...(headCovered ? [] : [epoch]),
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
  let previous = retained?.times.filter(t => t > start && t < end && !required.includes(t)) ?? [];
  // Leave room for the new edges and current head. Merged intervals are always
  // re-evaluated; they never inherit certification from their former children.
  const excess = Math.max(0, previous.length + required.length - count);
  if (excess) {
    const removed = new Set(Array.from({length:excess}, (_, i) => Math.floor(i * previous.length / excess)));
    previous = previous.filter((_, i) => !removed.has(i));
  }
  let times = [
    ...new Set([
      ...required,
      ...previous,
      ...Array.from(
        { length: previous.length ? 0 : seeds + 1 },
        (_, i) => start + ((end - start) * i) / seeds,
      ),
    ]),
  ].sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 1; i < times.length; i++)
    segments.push(yield* evaluate(times[i - 1], times[i]));
  let reallocations=0;
  const rejectedMerges=new Set<string>();
  while (times.length < count || (observerChanged && retained && previous.length && reallocations<count*2)) {
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
    if(times.length>=count) {
      // Reclaim only a distant node whose merged interval is independently
      // certified against the same observer/error/gap constraints.
      const candidates:{index:number;score:number}[]=[];
      for(let i=0;i+1<segments.length;i++) {
        if(i%64===0)yield;
        const left=segments[i],right=segments[i+1],key=`${left.a}:${right.b}`;
        if(required.includes(left.b) || left.terminal || right.terminal || rejectedMerges.has(key))continue;
        const score=Math.max(left.score,right.score);
        if(score<1)candidates.push({index:i,score});
      }
      if(!candidates.length)break;
      candidates.sort((a,b)=>a.score-b.score);
      const selected:number[]=[],used=new Set<number>();
      const desired=Math.max(1,Math.min(Math.floor(count/8),segments.filter(s=>!s.terminal&&s.score>1).length*2));
      for(const candidate of candidates) {
        const i=candidate.index;
        if(used.has(i)||used.has(i+1))continue;
        selected.push(i);used.add(i);used.add(i+1);
        if(selected.length>=desired)break;
      }
      // Descending disjoint pairs preserve the remaining interval indices.
      selected.sort((a,b)=>b-a);
      for(const candidate of selected) {
        const left=segments[candidate],right=segments[candidate+1];
        const merged=yield* evaluate(left.a,right.b);
        reallocations++;
        if(!merged.terminal && merged.score<=1 && ![...failures].some(t=>t>=merged.a && t<=merged.b)) {
          segments.splice(candidate,2,merged);
          times.splice(times.indexOf(left.b),1);
        } else rejectedMerges.add(`${left.a}:${right.b}`);
      }
      continue;
    }
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
  // If refinement exhausted the remaining slots, discard the old camera's
  // allocation rather than accept a worse near-view result than a fresh build.
  if (observerChanged && retained && previous.length && segments.some(s => !s.terminal && s.score > 1)) {
    retained.times = [];
    retained.segments.clear();
    return yield* adaptiveTrailSteps(start, epoch, end, count, position, period, boundaries, observer, retained, reuseCertifiedHead);
  }
  times.sort((a, b) => a - b);
  const bad = [...failures].sort((a, b) => a - b),
    unresolved = new Set<number>();
  let failure = 0;
  for (let i=0;i<segments.length;i++) {
    if (i % 16 === 0) yield;
    const s = segments[i];
    while (failure < bad.length && bad[failure] < s.a) failure++;
    // Exhausted geometric refinement is an approximation, not a source gap.
    // Keep the best covered polyline; only missing source data breaks it.
    if (failure < bad.length && bad[failure] <= s.b) unresolved.add(s.b);
  }
  if (retained) {
    retained.times = times;
    retained.segments.clear();
    for (const s of segments) {
      // Gap intervals must probe again: missing coverage may have loaded.
      if (!unresolved.has(s.b)) retained.segments.set(`${s.a}:${s.b}`, s);
    }
    // Bound probe memory independently of the number of playback updates.
    if (cache.size > count * 32) {
      const endpoints = new Set(times);
      for (const t of cache.keys()) if (!endpoints.has(t)) cache.delete(t);
    }
    for (const [t, p] of cache) if (!p) cache.delete(t);
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
