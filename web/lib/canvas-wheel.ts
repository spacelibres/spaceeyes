export function canvasWheelDelta(deltaY: number, mode: number, pageHeight: number): number | undefined {
  if (!Number.isFinite(deltaY) || deltaY === 0) return undefined;
  // NASA Eyes Input scales pixel wheel deltas by .1 and ZoomController
  // applies 2^(offset * .05). The SDK consumes natural-log zoom instead.
  const pixelScale = Math.LN2 * 0.005;
  const unit = mode === 1 ? 100 * pixelScale : mode === 2 ? Math.max(1, pageHeight) * pixelScale : pixelScale;
  const delta = deltaY * unit;
  return Number.isFinite(delta) ? Math.max(-1, Math.min(1, delta)) : undefined;
}
/** The host owns browser wheel input; do not also forward it to winit. */
export function handleCanvasWheel(
  event: Pick<WheelEvent, "deltaY" | "deltaMode" | "preventDefault" | "stopImmediatePropagation">,
  pageHeight: number,
  emit: (delta: number) => void,
): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  const delta = canvasWheelDelta(event.deltaY, event.deltaMode, pageHeight);
  if (delta !== undefined) emit(delta);
}
