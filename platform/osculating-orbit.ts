type V = [number, number, number];
const dot = (a: V, b: V) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: V, b: V): V => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
/** Instantaneous two-body display ellipse, not an ephemeris outside source coverage. */
export function osculatingOrbit(position: V, velocity: V, mu: number, epoch: number, count: number, detailed: boolean) {
  const radius = Math.hypot(...position), h = cross(position, velocity), h2 = dot(h,h);
  if (![...position,...velocity,mu,epoch].every(Number.isFinite) || mu <= 0 || radius <= 0 || h2 <= 0)
    return undefined;
  const radial = position.map(x => x/radius) as V;
  const tangent = cross(h,radial).map(x => x/Math.sqrt(h2)) as V;
  const vxh = cross(velocity,h);
  const ev = vxh.map((x,i) => x/mu-radial[i]) as V;
  const e = Math.hypot(...ev), a = 1/(2/radius-dot(velocity,velocity)/mu);
  if (!Number.isFinite(a) || a <= 0 || e >= 1) return undefined;
  const ec = dot(ev,radial), es = dot(ev,tangent), p = h2/mu;
  const f0 = e > 1e-12 ? Math.atan2(-es,ec) : 0;
  const mean = (f: number) => {
    const turns = Math.floor((f+Math.PI)/(2*Math.PI));
    const w = f-turns*2*Math.PI;
    const E = Math.atan2(Math.sqrt(1-e*e)*Math.sin(w),e+Math.cos(w));
    return E-e*Math.sin(E)+turns*2*Math.PI;
  };
  const m0 = mean(f0), n = Math.sqrt(mu/a**3), period = 2*Math.PI/n;
  const uniform = detailed ? Math.floor(count/2) : count-1;
  const angles = [0,...Array.from({length:uniform},(_,i) => -Math.PI+2*Math.PI*i/(uniform-1))];
  for(let i=0; i<count-uniform-1; i++) {
    const u=2*i/(count-uniform-2)-1;
    angles.push(Math.sign(u)*Math.PI*Math.expm1(12*Math.abs(u))/Math.expm1(12));
  }
  // At large epochs sub-millisecond offsets can round to the same Float64 time.
  const samples = new Map<number,V>();
  for(const angle of angles.sort((x,y)=>x-y)) {
    const c=Math.cos(angle), s=Math.sin(angle), r=p/(1+ec*c+es*s);
    samples.set(epoch+(mean(f0+angle)-m0)/n, radial.map((x,i)=>r*(x*c+tangent[i]*s)) as V);
  }
  samples.set(epoch,[...position]);
  const entries = [...samples].sort(([x],[y])=>x-y);
  // Same parametric ellipse point, not a chord bridging unrelated historical endpoints.
  entries.at(-1)![1]=[...entries[0][1]];
  return { points: entries.map(([,v])=>v), epochsTdbSeconds: entries.map(([t])=>t), period };
}
