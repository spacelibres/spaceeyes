export interface RendererStartupStatus {
  frames:number;
  pending:number;
  failed:number;
  stableFrames:number;
}

/** Render the empty scene before beginning the initial data requests. */
export function waitForFirstSceneFrames(
 read:()=>RendererStartupStatus,
 signal:AbortSignal,
 request:typeof requestAnimationFrame,
 cancel:typeof cancelAnimationFrame,
):Promise<void> {
 return new Promise((resolve,reject)=>{
  let frame:number|undefined;
  const finish=(error?:unknown)=>{
   if(frame!==undefined)cancel(frame);
   signal.removeEventListener('abort',aborted);
   if(error!==undefined)reject(error);else resolve();
  };
  const aborted=()=>finish(signal.reason??new DOMException('Aborted','AbortError'));
  const poll=()=>{
   frame=undefined;
   if(signal.aborted){aborted();return;}
   try{
    const status=read();
    if(!status||![status.frames,status.pending,status.failed,status.stableFrames].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Renderer startup status unavailable');
    if(status.failed)throw Error('Renderer shader compilation failed');
    if(status.frames>=3&&status.pending===0&&status.stableFrames>=3){finish();return;}
    frame=request(poll);
   }catch(error){finish(error);}
  };
  signal.addEventListener('abort',aborted,{once:true});
  poll();
 });
}

/** Observe actual GPU preparation, never a fixed splash-screen timeout. */
export function waitForRendererStartup(
 read:()=>RendererStartupStatus,
 resourcesReady:()=>boolean,
 signal:AbortSignal,
 request:typeof requestAnimationFrame,
 cancel:typeof cancelAnimationFrame,
):Promise<void> {
 return new Promise((resolve,reject)=>{
  let frame:number|undefined,assetsFrame:number|undefined;
  const finish=(error?:unknown)=>{
   if(frame!==undefined)cancel(frame);
   signal.removeEventListener('abort',aborted);
   if(error!==undefined)reject(error);else resolve();
  };
  const aborted=()=>finish(signal.reason??new DOMException('Aborted','AbortError'));
  const poll=()=>{
   frame=undefined;
   if(signal.aborted){aborted();return;}
   try {
    const status=read();
    if(!status||![status.frames,status.pending,status.failed,status.stableFrames].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('Renderer startup status unavailable');
    if(status.failed)throw Error('Renderer shader compilation failed');
    if(!resourcesReady())assetsFrame=undefined;
    else assetsFrame??=status.frames;
    if(assetsFrame!==undefined&&status.frames-assetsFrame>=3&&status.stableFrames>=3&&status.pending===0){finish();return;}
    frame=request(poll);
   }catch(error){finish(error);}
  };
  signal.addEventListener('abort',aborted,{once:true});
  poll();
 });
}
