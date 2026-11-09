import type {DecodedDyn, DynVector} from "./dyn-decoder.ts";

/** Recovered Eyes TrailComponent._getAutoLength orb branch, not a propagation solver.
 * Position/velocity must be in the source's parent frame (km and km/s).
 * Undefined leaves degenerate or unavailable inputs to the caller's bounded fallback.
 */
export function eyesOrbAutoLength(
  data: DecodedDyn,
  epoch: number,
  position: DynVector,
  velocity: DynVector,
): number | undefined {
  if (data.kind !== "inline" || data.type !== "orb" || !Number.isFinite(epoch) ||
      epoch < data.coverage.start || epoch > data.coverage.end || data.records.length < 2)
    return undefined;
  let lo=0, hi=data.records.length-1;
  while (hi-lo>1) {
    const mid=(lo+hi)>>1;
    if (data.records[mid].time<=epoch) lo=mid; else hi=mid;
  }
  const a=data.records[lo], b=data.records[hi];
  if (!(b.time>a.time)) return undefined;
  const u=Math.max(0,Math.min(1,(epoch-a.time)/(b.time-a.time)));
  const e=a.eccentricity+(b.eccentricity-a.eccentricity)*u;
  const mu=(data.gravitationalParameter1??1)+(data.gravitationalParameter2??0);
  const [x,y,z]=position, [vx,vy,vz]=velocity;
  const h2=(y*vz-z*vy)**2+(z*vx-x*vz)**2+(x*vy-y*vx)**2;
  if (!Number.isFinite(e) || e<0 || !Number.isFinite(mu) || mu<=0 || !Number.isFinite(h2) || h2<=0)
    return undefined;
  const energy=mu*mu/h2*(-0.5)*(1-e*e);
  // Preserve NASA's asymmetric clamp, including its hyperbolic display policy.
  const duration=2*Math.PI*mu/Math.sqrt(8*Math.abs(Math.min(1,energy*energy*energy)));
  return Number.isFinite(duration) && duration>0 ? duration : undefined;
}
