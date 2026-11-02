/** Initial paths use idle frame slots; existing paths retain their own cadence. */
export function shouldRefreshTrajectory(
  pending: boolean,
  expired: boolean,
  selected: boolean,
  elapsedSinceBuild: number,
  elapsedSinceSelected: number,
): boolean {
  return pending || (expired && (selected ? elapsedSinceSelected >= 100 : elapsedSinceBuild >= 50));
}
