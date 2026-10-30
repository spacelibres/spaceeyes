/** Touch-only intent classification. Mouse remains owned by the renderer. */
export class TouchCamera {
  #tap: [number, number, number] | undefined;
  #points = new Map<number, [number, number]>();
  begin(id: number, x: number, y: number, kind: string) {
    if (kind !== "touch") return false;
    this.#tap = this.#points.size === 0 ? [id, x, y] : undefined;
    this.#points.set(id, [x, y]);
    return true;
  }
  move(
    id: number,
    x: number,
    y: number,
  ): { orbit?: [number, number]; zoom?: number } | undefined {
    const old = this.#points.get(id);
    if (!old || !Number.isFinite(x + y)) return;
    if (this.#tap && Math.hypot(x - this.#tap[1], y - this.#tap[2]) > 6)
      this.#tap = undefined;
    const other = [...this.#points].find(([key]) => key !== id)?.[1];
    this.#points.set(id, [x, y]);
    const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
    if (other) {
      const before = Math.hypot(old[0] - other[0], old[1] - other[1]);
      const after = Math.hypot(x - other[0], y - other[1]);
      return {
        zoom: before > 0 && after > 0 ? clamp(-Math.log(after / before), 1) : 0,
      };
    }
    return {
      orbit: [
        clamp(-(x - old[0]) * 0.005, 0.5),
        clamp(-(y - old[1]) * 0.005, 0.5),
      ],
    };
  }
  end(id: number): [number, number] | undefined {
    const point = this.#tap?.[0] === id ? this.#points.get(id) : undefined;
    this.#tap = undefined;
    this.#points.delete(id);
    return point;
  }
  clear() {
    this.#tap = undefined;
    this.#points.clear();
  }
}
