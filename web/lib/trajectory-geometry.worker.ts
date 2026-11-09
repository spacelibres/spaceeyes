import {TrajectoryGeometryRuntime,type GeometryMessage} from '../../platform/trajectory-geometry-runtime.ts';
const scope=self as unknown as {onmessage:((event:MessageEvent<GeometryMessage>)=>void)|null;postMessage:(value:unknown,transfer:ArrayBuffer[])=>void};
// A message task yields to source/cancel messages without nested-timer clamping.
// The runtime owns at most one scheduled callback and keeps its 15 ms quantum.
const channel=new MessageChannel();
let pending:(()=>void)|undefined;
channel.port1.onmessage=()=>{const run=pending;pending=undefined;run?.();};
const runtime=new TrajectoryGeometryRuntime((reply,transfer)=>scope.postMessage(reply,transfer),run=>{pending=run;channel.port2.postMessage(0);});
scope.onmessage=event=>runtime.receive(event.data);
