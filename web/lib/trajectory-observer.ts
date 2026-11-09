export type TrajectoryObserver = { camera: readonly number[]; target: readonly number[] };
export function trajectoryObserverChanged(previous: TrajectoryObserver | undefined, next: TrajectoryObserver) {
  if(!previous) return true;
  const distance=(a:readonly number[],b:readonly number[])=>Math.hypot(...a.map((x,i)=>x-b[i]));
  const threshold=Math.max(1e-6,distance(next.camera,next.target)*0.25);
  return distance(previous.camera,next.camera)>threshold || distance(previous.target,next.target)>threshold;
}


type CameraSnapshot = Readonly<Record<string,unknown>>;
const vector3=(value:unknown):value is number[]=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const followBasis=(direction:readonly number[])=>{
  const length=Math.hypot(...direction);if(length<1e-12)return undefined;
  const forward=direction.map(v=>v/length),sideLength=Math.hypot(forward[0],forward[1]);
  const side=sideLength>1e-12?[forward[1]/sideLength,-forward[0]/sideLength,0]:[1,0,0];
  const up=[forward[1]*side[2]-forward[2]*side[1],forward[2]*side[0]-forward[0]*side[2],forward[0]*side[1]-forward[1]*side[0]];
  return [forward,side,up];
};
/** Move the measured camera offset with its actual framing reference at one epoch. */
export function coherentTrajectoryObserver(snapshot:CameraSnapshot|undefined,id:string,epoch:number,position:(id:string,epoch:number)=>readonly number[]):TrajectoryObserver|undefined {
  if(!snapshot||!Number.isFinite(snapshot.epochTdbSeconds)||!vector3(snapshot.positionKm)||!vector3(snapshot.framingReferencePositionKm)||typeof snapshot.framingReferenceId!=="string")return;
  const anchor=position(snapshot.framingReferenceId,epoch),target=position(id,epoch);
  if(!vector3([...anchor])||!vector3([...target]))return;
  let offset=snapshot.positionKm.map((v,i)=>v-(snapshot.framingReferencePositionKm as number[])[i]);
  if(typeof snapshot.followReferenceId==="string"&&vector3(snapshot.followReferencePositionKm)) {
    const followed=position(snapshot.followReferenceId,epoch);
    const before=followBasis(snapshot.followReferencePositionKm.map((v,i)=>v-(snapshot.framingReferencePositionKm as number[])[i]));
    const after=followBasis(followed.map((v,i)=>v-anchor[i]));
    if(before&&after) {
      const components=before.map(axis=>axis.reduce((sum,v,i)=>sum+v*offset[i],0));
      offset=[0,1,2].map(i=>after.reduce((sum,axis,j)=>sum+axis[i]*components[j],0));
    }
  }
  return {camera:offset.map((v,i)=>v+anchor[i]),target:[...target]};
}
