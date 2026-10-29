export function parseEpoch(value: string): number {
  if (!value.trim()) throw Error("请输入J2000 TDB秒");
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch < 0 || epoch > 1e9)
    throw Error("夹具覆盖为0至1000000000 TDB秒");
  return epoch;
}
export function boundedEpoch(epoch: number): {
  epoch: number;
  boundary: boolean;
} {
  return {
    epoch: Math.max(0, Math.min(1e9, epoch)),
    boundary: epoch < 0 || epoch > 1e9,
  };
}
/** Idempotent asynchronous cleanup, including callers racing shutdown. */
export function onceAsync(cleanup: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => (pending ??= Promise.resolve().then(cleanup));
}
