import { rotateVector } from "./eyes-controllers.ts";
/** Private bounded historical evaluators. Never publishes platform state. */
export interface HistorySource {
  load(
    ids: readonly string[],
    epoch: number,
    orientationIds: readonly string[],
  ): Promise<void>;
  position(id: string, epoch: number): readonly number[];
  orientation?(id:string,epoch:number):readonly [number,number,number,number];
  coverage(id: string): readonly number[] | undefined;
  dispose(): void;
  cacheStats?(): { records: number };
  needsPositionRefresh?(id:string,epoch:number):boolean;
}
export type HistoryOptions = {
  createSource(signal: AbortSignal, remainingRecords: number): HistorySource;
  parentAt(id: string, epoch: number): string | null;
  boundaries(id: string): readonly number[];
  phaseAt?(id:string,epoch:number):string;
  maxSegments?: number;
  maxRecords?: number;
};
type Segment = {
  start: number;
  end: number;
  parent: string | null;
  phase?: string;
  source: HistorySource;
};
export interface PreparedHistory {
  readonly start: number;
  readonly end: number;
  readonly boundaries: readonly number[];
  readonly gaps: readonly (readonly [number, number])[];
  position(epoch: number): [number, number, number];
  dispose(): void;
}
export class TrailHistory {
  #options: HistoryOptions;
  #abort = new AbortController();
  #sources = new Set<HistorySource>();
  constructor(options: HistoryOptions) {
    if (
      !Number.isInteger(options.maxSegments ?? 32) ||
      (options.maxSegments ?? 32) < 1 ||
      (options.maxSegments ?? 32) > 32 ||
      !Number.isSafeInteger(options.maxRecords ?? 1000000) ||
      (options.maxRecords ?? 1000000) < 1
    )
      throw Error("Invalid history budget");
    this.#options = options;
  }
  async prepare(
    id: string,
    epoch: number,
    start: number,
    end: number,
    currentOrigin?: string,
    signal?: AbortSignal,
    policy?: {referenceOrientation?:boolean},
  ): Promise<PreparedHistory> {
    if (
      ![epoch, start, end].every(Number.isFinite) ||
      start >= end ||
      epoch < start ||
      epoch > end
    )
      throw Error("Invalid history range");
    const abort = AbortSignal.any([
      this.#abort.signal,
      ...(signal ? [signal] : []),
    ]);
    abort.throwIfAborted();
    const owned = new Set<HistorySource>();
    let released = false;
    const releaseSource = (source: HistorySource) => {
      if (owned.delete(source)) {
        this.#sources.delete(source);
        source.dispose();
      }
    };
    const dispose = () => {
      released = true;
      for (const source of [...owned]) releaseSource(source);
      abort.removeEventListener("abort", dispose);
    };
    abort.addEventListener("abort", dispose, { once: true });
    const phases = [...new Set([
      start,
      ...this.#options
        .boundaries(id)
        .filter((t) => Number.isFinite(t) && t > start && t < end),
      end,
    ])].sort((a, b) => a - b);
    const pending = phases
      .slice(1)
      .map((b, i) => [phases[i], b] as [number, number]);
    if(this.#options.phaseAt) for(const boundary of phases.slice(1,-1))pending.push([boundary,boundary]);
    const segments: Segment[] = [];
    const gaps: [number, number][] = [];
    let attempts = 0,
      records = 0;
    try {
      while (pending.length) {
        abort.throwIfAborted();
        const [a, b] = pending.shift()!;
        const t = a===b ? a : epoch >= a && epoch < b ? epoch : a + (b - a) / 2;
        const phase=this.#options.phaseAt?.(id,t);
        // Shared inclusive endpoints can have a controller combination that
        // exists only at that instant. Reuse a matching source or prepare it.
        if(a===b&&segments.some(s=>t>=s.start&&t<=s.end&&s.parent===this.#options.parentAt(id,t)&&s.phase===phase&&
          !s.source.needsPositionRefresh?.(id,t)&&(!currentOrigin||!s.source.needsPositionRefresh?.(currentOrigin,t))))continue;
        if (++attempts > (this.#options.maxSegments ?? 32))
          throw Error("History segment budget");
        const remainingRecords =
          (this.#options.maxRecords ?? 1000000) - records;
        if (remainingRecords < 1) throw Error("History record budget");
        const source = this.#options.createSource(abort, remainingRecords);
        owned.add(source);
        this.#sources.add(source);
        try {
          await source.load(
            [
              ...new Set([
                id,
                ...(currentOrigin && currentOrigin !== "sun"
                  ? [currentOrigin]
                  : []),
              ]),
            ],
            t,
            policy?.referenceOrientation && currentOrigin ? [currentOrigin] : [],
          );
        } catch (error) {
          abort.throwIfAborted();
          releaseSource(source);
          gaps.push([a, b]);
          continue;
        }
        abort.throwIfAborted();
        if (released) throw Error("History released");
        records += source.cacheStats?.().records ?? 0;
        if (records > (this.#options.maxRecords ?? 1000000))
          throw Error("History record budget");
        const ranges = [
          source.coverage(id),
          ...(currentOrigin && currentOrigin !== "sun"
            ? [source.coverage(currentOrigin)]
            : []),
        ];
        if (
          ranges.some(
            (r) =>
              !r ||
              r.length !== 2 ||
              !r.every(Number.isFinite) ||
              r[0] > t ||
              r[1] < t,
          )
        ) {
          releaseSource(source);
          gaps.push([a, b]);
          continue;
        }
        const lo = Math.max(a, ...ranges.map((r) => r![0]));
        const hi = Math.min(b, ...ranges.map((r) => r![1]));
        if (lo > hi || (lo === hi && a!==b)) {
          releaseSource(source);
          gaps.push([a, b]);
          continue;
        }
        segments.push({
          start: lo,
          end: hi,
          parent: this.#options.parentAt(id, t),
          phase,
          source,
        });
        if (lo > a) pending.push([a, lo]);
        if (hi < b) pending.push([hi, b]);
      }
      segments.sort((a, b) => a.start - b.start);
      const boundaries = Object.freeze(
        [
          ...new Set([
            ...phases,
            ...segments.flatMap((s) => [s.start, s.end]),
            ...gaps.flat(),
          ]),
        ].sort((a, b) => a - b),
      );
      return Object.freeze({
        start,
        end,
        boundaries,
        gaps: Object.freeze(gaps.map((g) => Object.freeze(g))),
        dispose,
        position: (t: number): [number, number, number] => {
          abort.throwIfAborted();
          if (released) throw Error("History released");
          const segment = segments.findLast(
            (s) =>
              t >= s.start &&
              t <= s.end &&
              s.parent === this.#options.parentAt(id, t) &&
              s.phase === this.#options.phaseAt?.(id,t) &&
              !s.source.needsPositionRefresh?.(id,t) &&
              (!currentOrigin||!s.source.needsPositionRefresh?.(currentOrigin,t)),
          );
          if (!segment) throw Error("History source gap");
          const p = segment.source.position(id, t),
            origin =
              currentOrigin && currentOrigin !== "sun"
                ? segment.source.position(currentOrigin, t)
                : [0, 0, 0];
          let result = p.map((v, i) => v - origin[i]);
          if(policy?.referenceOrientation && currentOrigin) {
            const q=segment.source.orientation?.(currentOrigin,t);
            if(!q)throw Error('History reference orientation unavailable');
            result=rotateVector(result as [number,number,number],[q[0],-q[1],-q[2],-q[3]]);
          }
          if (result.length !== 3 || !result.every(Number.isFinite))
            throw Error("Invalid history position");
          return result as [number, number, number];
        },
      });
    } catch (error) {
      dispose();
      throw error;
    }
  }
  dispose() {
    this.#abort.abort(new Error("History disposed"));
    for (const source of this.#sources) source.dispose();
    this.#sources.clear();
  }
}
