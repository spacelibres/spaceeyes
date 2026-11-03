/** Initial paths use idle frame slots; existing paths retain their own cadence. */
export function shouldRefreshTrajectory(
  pending: boolean,
  expired: boolean,
  selected: boolean,
  elapsedSinceBuild: number,
  elapsedSinceSelected: number,
  spacecraft = false,
): boolean {
  return pending || (expired && (spacecraft || (selected ? elapsedSinceSelected >= 100 : elapsedSinceBuild >= 50)));
}


/** Start asynchronous scientific work before the last valid cached frame. */
export function trajectoryWindowDue(window: readonly number[] | undefined, epoch: number, rate: number, playing: boolean, frameSeconds: number, computeLeadSeconds = 0): boolean {
  if(!window || epoch<window[0] || epoch>window[1])return true;
  if(!playing || rate===0)return false;
  const measured=Number.isFinite(computeLeadSeconds)?Math.max(0,computeLeadSeconds):0;
  const lead=measured>0
    ? Math.min((window[1]-window[0])*.75,Math.abs(rate)*Math.max(frameSeconds*2,measured))
    : Math.min((window[1]-window[0])/4,Math.abs(rate)*frameSeconds*2);
  return rate>0 ? epoch+lead>=window[1] : epoch-lead<=window[0];
}
