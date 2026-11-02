export interface TrajectoryWork<T> {
  objectId: string;
  revision: number;
  create: () => Generator<void, T>;
  commit: (value: T) => void;
  release?: () => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}
type Held<T> = {
  job: TrajectoryWork<T>;
  iterator: Generator<void, T>;
  abort?: () => void;
  ready?: { value: T };
};
/** Cooperative work: each iterator next must perform at most one bounded sampling operation. */
export class TrajectoryWorkQueue<T> {
  private active: Held<T>[] = [];
  private pending = new Map<string, TrajectoryWork<T>>();
  private now: () => number;
  private maxPending: number;
  constructor(now: () => number = () => performance.now(), maxPending = 64) {
    this.now = now;
    this.maxPending = maxPending;
  }
  enqueue(job: TrajectoryWork<T>) {
    const current =
      this.pending.get(job.objectId) ??
      this.active.find((x) => x.job.objectId === job.objectId)?.job;
    if (current && current.revision >= job.revision) {
      job.release?.();
      return;
    }
    this.cancel(job.objectId);
    if (job.signal?.aborted) {
      job.release?.();
      return;
    }
    if (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value!;
      this.cancel(oldest);
    }
    this.pending.set(job.objectId, job);
  }
  cancel(objectId: string) {
    const pending = this.pending.get(objectId);
    if (pending) {
      this.pending.delete(objectId);
      pending.release?.();
    }
    const index = this.active.findIndex((x) => x.job.objectId === objectId);
    if (index >= 0) {
      const [held] = this.active.splice(index, 1);
      this.dispose(held);
    }
  }
  clear() {
    for (const id of [
      ...this.pending.keys(),
      ...this.active.map((x) => x.job.objectId),
    ])
      this.cancel(id);
  }
  private dispose(held: Held<T>) {
    if (held.abort) held.job.signal?.removeEventListener("abort", held.abort);
    try {
      held.iterator.return(undefined as T);
    } catch {
      // Cancellation must release resources without reviving error callbacks.
    } finally {
      held.job.release?.();
    }
  }
  private report(job: TrajectoryWork<T>, error: unknown) {
    if (!job.signal?.aborted)
      try {
        job.onError?.(error);
      } catch {
        /* Observers cannot stop authoritative time. */
      }
  }
  turn({ budgetMs, maxSteps }: { budgetMs: number; maxSteps: number }) {
    const started = this.now();
    const deadline = started + Math.max(0, budgetMs);
    let commitMs = 0;
    let steps = 0,
      completed = 0;
    while (steps < maxSteps && this.now() < deadline) {
      while (this.active.length < 2 && this.pending.size) {
        const [id, job] = this.pending.entries().next().value!;
        this.pending.delete(id);
        if (job.signal?.aborted) {
          job.release?.();
          continue;
        }
        let iterator: Generator<void, T>;
        try {
          iterator = job.create();
        } catch (error) {
          job.release?.();
          this.report(job, error);
          continue;
        }
        const held: Held<T> = { job, iterator };
        held.abort = () => this.cancel(id);
        job.signal?.addEventListener("abort", held.abort, { once: true });
        this.active.push(held);
      }
      const held = this.active.shift();
      if (!held) break;
      if (held.job.signal?.aborted) {
        this.dispose(held);
        continue;
      }
      let result: IteratorResult<void, T>;
      try {
        if (held.ready) result = { done: true, value: held.ready.value };
        else {
          result = held.iterator.next();
          steps++;
        }
      } catch (error) {
        this.dispose(held);
        this.report(held.job, error);
        continue;
      }
      if (result.done) {
        if (this.now() >= deadline) {
          held.ready = { value: result.value };
          this.active.unshift(held);
          break;
        }
        const commitStarted = this.now();
        try {
          if (!held.job.signal?.aborted) held.job.commit(result.value);
        } catch (error) {
          this.report(held.job, error);
        } finally {
          commitMs += this.now() - commitStarted;
          this.dispose(held);
        }
        completed++;
        break;
      }
      this.active.push(held);
    }
    return {
      steps,
      completed,
      commitMs,
      samplingMs: Math.max(0, this.now() - started - commitMs),
      active: this.active.length,
      pending: this.pending.size,
    };
  }
}
