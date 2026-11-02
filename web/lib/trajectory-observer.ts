export type TrajectoryObserver = { camera: readonly number[]; target: readonly number[] };
export function trajectoryObserverChanged(previous: TrajectoryObserver | undefined, next: TrajectoryObserver) {
  if(!previous) return true;
  const distance=(a:readonly number[],b:readonly number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
  const threshold=Math.max(1e-6,distance(next.camera,next.target)*0.25);
  return distance(previous.camera,next.camera)>threshold || distance(previous.target,next.target)>threshold;
}
