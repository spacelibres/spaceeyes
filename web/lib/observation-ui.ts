/** NASA TimeControls._drawKnob; x is normalized, y is in the 50px curve box. */
export function timeKnob(index: number): { x: number; y: number } {
  if (!Number.isFinite(index)) throw Error("Invalid time slider position");
  const x = Math.max(0, Math.min(100, index)) / 100;
  return { x, y: 37.5 * (1 - 0.95 * Math.pow(2 * Math.abs(x - 0.5), 3.2)) };
}
export function observationClock(utc: string): { date: string; time: string } {
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime()))
    return { date: "等待仿真时间", time: "—" };
  return {
    date: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date),
    time: date.toISOString().slice(11, 19),
  };
}
/** Leading/trailing dispatch: local knob stays immediate, host updates are bounded. */
export class RateDispatcher {
  private pending: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = -Infinity;
  private send: (rate: number) => void;
  private now: () => number;
  private schedule: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  private clear: (timer: ReturnType<typeof setTimeout>) => void;
  constructor(
    send: (rate: number) => void,
    now = () => performance.now(),
    schedule = (callback: () => void, ms: number) => setTimeout(callback, ms),
    clear = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  ) {
    this.send = send;
    this.now = now;
    this.schedule = schedule;
    this.clear = clear;
  }
  request(rate: number): void {
    if (!Number.isFinite(rate)) throw Error("Invalid time rate");
    this.pending = rate;
    const remaining = 200 - (this.now() - this.last);
    if (remaining <= 0) this.flush();
    else if (this.timer === undefined)
      this.timer = this.schedule(() => {
        this.timer = undefined;
        this.flush();
      }, remaining);
  }
  flush(): void {
    if (this.timer !== undefined) this.clear(this.timer);
    this.timer = undefined;
    if (this.pending === undefined) return;
    const rate = this.pending;
    this.pending = undefined;
    this.last = this.now();
    this.send(rate);
  }
  cancel(): void {
    if (this.timer !== undefined) this.clear(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
}
