declare module 'three/addons/loaders/EXRLoader.js' {
  export class EXRLoader {
    setDataType(type:number):this;
    parse(buffer:ArrayBuffer):{width:number;height:number;data:Float32Array;flipY:boolean};
  }
}
declare module 'three' { export const FloatType:number; }
