/** Prefetch real source chunks in expiry order; merged coverage is not chunk cadence. */
export function positionPrefetchCandidates(
 sources:readonly {id:string;status:string;positionSource?:string;coverage?:readonly number[]}[],
 epoch:number,rate:number,now:number,leadSeconds:number,inflight:ReadonlySet<string>,retryAt:ReadonlyMap<string,number>,chunkSpans:ReadonlyMap<string,number>,
) {
 if(!Number.isFinite(rate)||rate===0)return [];
 const speed=Math.abs(rate);
 return sources.flatMap(source=>{
  if(source.status!=='ready'||source.positionSource!=='dyn'||!source.coverage||inflight.has(source.id)||now<(retryAt.get(source.id)??0))return [];
  const edge=rate>0?source.coverage[1]:source.coverage[0];
  const untilExpiry=(rate>0?edge-epoch:epoch-edge)/speed;
  if(untilExpiry>leadSeconds)return [];
  const span=chunkSpans.get(source.id)??source.coverage[1]-source.coverage[0];
  const cooldownMs=Math.min(5000,Math.max(0,span)/speed*250);
  return [{id:source.id,requested:edge+(rate>0?1:-1),untilExpiry,cooldownMs,coverage:source.coverage}];
 }).sort((a,b)=>a.untilExpiry-b.untilExpiry||a.id.localeCompare(b.id));
}
