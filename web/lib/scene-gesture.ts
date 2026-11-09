export type ScenePointer = {
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  isPrimary: boolean;
};

/** Input classification only. Coordinates and hit authority stay in Rust. */
export class SceneGesture {
  #start: ScenePointer | undefined;
  begin(event: ScenePointer): void {
    this.#start =
      event.isPrimary &&
      event.button === 0 &&
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY)
        ? { ...event }
        : undefined;
  }
  move(event: ScenePointer): void {
    const start = this.#start;
    if (
      start &&
      (event.pointerId !== start.pointerId ||
        !event.isPrimary ||
        !Number.isFinite(event.clientX) ||
        !Number.isFinite(event.clientY) ||
        Math.hypot(
          event.clientX - start.clientX,
          event.clientY - start.clientY,
        ) > 6)
    )
      this.cancel();
  }
  cancel(): void {
    this.#start = undefined;
  }
  end(event: ScenePointer): [number, number] | undefined {
    this.move(event);
    const start = this.#start;
    this.cancel();
    if (start && event.button === 0) return [event.clientX, event.clientY];
    return undefined;
  }
}
