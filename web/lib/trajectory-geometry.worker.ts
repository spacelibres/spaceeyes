import {TrajectoryGeometryRuntime,type GeometryMessage} from '../../platform/trajectory-geometry-runtime.ts';
const scope=self as unknown as {onmessage:((event:MessageEvent<GeometryMessage>)=>void)|null;postMessage:(value:unknown,transfer:ArrayBuffer[])=>void};
const runtime=new TrajectoryGeometryRuntime((reply,transfer)=>scope.postMessage(reply,transfer),run=>setTimeout(run,0));
scope.onmessage=event=>runtime.receive(event.data);
