export type AsyncPhase =
  | "configure"
  | "reloadApply"
  | "secondaryApply"
  | "checkpoint";
/** Bounded host telemetry; RAF callbacks are not renderer frame counts. */
export class FrameMonitor {
  private nextDue: number | undefined;
  private admitted: number[] = [];
  private anchor: number | undefined;
  private raf: number[] = [];
  private work: number[] = [];
  private slices: number[] = [];
  private publications: number[] = [];
  private longTasks: number[] = [];
  private previousRaf: number | undefined;
  private frames = 0;
  private phaseSamples: Record<AsyncPhase, number[]> = {
    configure: [],
    reloadApply: [],
    secondaryApply: [],
    checkpoint: [],
  };
  private clock: () => number;
  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }
  recordPhase(phase: AsyncPhase, ms: number) {
    if (Object.prototype.hasOwnProperty.call(this.phaseSamples, phase))
      this.push(this.phaseSamples[phase], ms);
  }
  measurePhase<T>(phase: AsyncPhase, work: () => T): T {
    const start = this.clock();
    try {
      return work();
    } finally {
      this.recordPhase(phase, this.clock() - start);
    }
  }

  reset() {
    this.nextDue = undefined;
    this.anchor = undefined;
    this.previousRaf = undefined;
  }
  accept(now: number, hz: number): number | undefined {
    if (this.previousRaf !== undefined)
      this.push(this.raf, now - this.previousRaf);
    this.previousRaf = now;
    if (this.anchor === undefined) {
      this.nextDue = now + 1000 / hz;
      this.anchor = now;
      this.frames++;
      return 0;
    }
    if (
      now + 1e-6 < this.nextDue! ||
      now - this.anchor + 1e-6 < 1000 / 60 - 0.5
    )
      return undefined;
    const period = 1000 / hz;
    this.nextDue =
      now - this.nextDue! >= period * 2 ? now + period : this.nextDue! + period;
    this.push(this.admitted, now - this.anchor);
    const elapsed = (now - this.anchor) / 1000;
    this.anchor = now;
    this.frames++;
    return elapsed;
  }
  recordWork(ms: number) {
    this.push(this.work, ms);
  }
  recordPublication(ms: number) {
    this.push(this.publications, ms);
  }
  recordSlice(ms: number) {
    this.push(this.slices, ms);
  }
  recordLongTask(ms: number) {
    this.push(this.longTasks, ms);
  }
  private push(ring: number[], value: number) {
    if (Number.isFinite(value) && value >= 0) {
      ring.push(value);
      if (ring.length > 240) ring.shift();
    }
  }
  snapshot(now: number) {
    const distribution = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const p = (q: number) =>
        sorted.length
          ? sorted[
              Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))
            ]
          : 0;
      return {
        samples: sorted.length,
        p50: p(0.5),
        p95: p(0.95),
        p99: p(0.99),
      };
    };
    return {
      asyncPhases: Object.fromEntries(
        Object.entries(this.phaseSamples).map(([name, values]) => [
          name,
          {
            ...distribution(values),
            latest: values.at(-1) ?? 0,
            mean: values.length
              ? values.reduce((a, b) => a + b, 0) / values.length
              : 0,
            max: values.length ? Math.max(...values) : 0,
          },
        ]),
      ) as Record<
        AsyncPhase,
        {
          samples: number;
          p50: number;
          p95: number;
          p99: number;
          latest: number;
          mean: number;
          max: number;
        }
      >,
      monotonicNowMs: now,
      hostFrames: this.frames,
      admittedIntervalMs: distribution(this.admitted),
      rafIntervalMs: distribution(this.raf),
      hostWorkMs: distribution(this.work),
      trajectorySliceMs: distribution(this.slices),
      trajectoryPublicationMs: distribution(this.publications),
      longTaskMs: distribution(this.longTasks),
    };
  }
}
