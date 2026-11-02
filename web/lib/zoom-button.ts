/** NASA Settings/CameraManager button timing, expressed as log-distance intent. */
export type Schedule = (run: () => void, milliseconds: number) => () => void;
export type ZoomDirection = -1 | 1;
const schedule: Schedule = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};
export function zoomButtonDelta(
  direction: ZoomDirection,
  held: boolean,
): number {
  if (direction !== -1 && direction !== 1)
    throw Error("Invalid zoom direction");
  return direction * (held ? 0.1 : 0.3) * Math.LN2;
}
export class ZoomButtonGesture {
  #pointer: number | undefined;
  #held = false;
  #direction: ZoomDirection | undefined;
  #revision = 0;
  #cancelTimer: (() => void) | undefined;
  #emit: (delta: number) => void;
  #schedule: Schedule;
  constructor(emit: (delta: number) => void, scheduler: Schedule = schedule) {
    this.#emit = emit;
    this.#schedule = scheduler;
  }
  begin(pointer: number, direction: ZoomDirection): void {
    this.cancel();
    if (!Number.isSafeInteger(pointer) || pointer < 0) return;
    zoomButtonDelta(direction, false);
    this.#pointer = pointer;
    this.#direction = direction;
    const revision = this.#revision;
    const current = () =>
      this.#pointer === pointer && this.#revision === revision;
    const tick = () => {
      if (!current()) return;
      this.#emit(zoomButtonDelta(direction, true));
      if (current()) this.#cancelTimer = this.#schedule(tick, 30);
    };
    this.#cancelTimer = this.#schedule(() => {
      if (!current()) return;
      this.#held = true;
      this.#cancelTimer = this.#schedule(tick, 30);
    }, 200);
  }
  end(pointer: number): void {
    if (this.#pointer !== pointer) return;
    const short = !this.#held;
    const step = this.#direction;
    this.cancel();
    if (short && step !== undefined) this.#emit(zoomButtonDelta(step, false));
  }
  click(detail: number, direction: ZoomDirection): void {
    // Pointer release already committed. Native keyboard activation has detail 0.
    if (detail !== 0) return;
    this.cancel();
    this.#emit(zoomButtonDelta(direction, false));
  }
  cancel(): void {
    this.#revision++;
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.#pointer = undefined;
    this.#direction = undefined;
    this.#held = false;
  }
}
