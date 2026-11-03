import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import {vec3} from 'gl-matrix';
import {EyesAssetService} from '../lib/eyes-assets.ts';
import {fileURLToPath} from 'node:url';
const service=new EyesAssetService({cacheDirectory:fileURLToPath(new URL('../.cache/eyes-assets',import.meta.url))});
const asset=await service.get('433_eros','model.glb');
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const doc=await io.readBinary(asset.bytes),edges=new Map<string,{count:number;direction:number}>();
let triangles=0,signedVolumeKm3=0;
for(const scene of doc.getRoot().listScenes())scene.traverse(node=>{
 const mesh=node.getMesh();if(!mesh)return;
 if(node.getSkin())throw Error('Skinned surface');
 for(const primitive of mesh.listPrimitives()){
  if(primitive.getMode()!==4||primitive.listTargets().length)throw Error('Non-static triangles');
  const positions=primitive.getAttribute('POSITION')!,indices=primitive.getIndices(),keys:string[]=[],points:number[][]=[];
  for(let i=0;i<positions.getCount();i++){
   const v:number[]=[0,0,0];positions.getElement(i,v);vec3.transformMat4(v,v,node.getWorldMatrix());
   keys.push(v.map(x=>Math.round(x/1e-5)).join(','));
   points.push(v);
  }
  const count=indices?.getCount()??positions.getCount();
  for(let i=0;i<count;i+=3){
   const ids=[0,1,2].map(j=>keys[indices?indices.getScalar(i+j):i+j]);triangles++;
   const [a,b,c]=[0,1,2].map(j=>points[indices?indices.getScalar(i+j):i+j]);
   signedVolumeKm3+=vec3.dot(a,vec3.cross([0,0,0],b,c))/6;
   for(let j=0;j<3;j++){
    const a=ids[j],b=ids[(j+1)%3],key=[a,b].sort().join('/'),row=edges.get(key)??{count:0,direction:0};
    row.count++;row.direction+=a<b?1:-1;edges.set(key,row);
   }
  }
 }
});
const invalid=[...edges].filter(([,v])=>v.count!==2||v.direction!==0);
console.log(JSON.stringify({id:'433_eros',convertedSha256:asset.sha256,weldToleranceKm:1e-5,triangles,edges:edges.size,invalidEdges:invalid.length,signedVolumeKm3},null,2));
if(invalid.length||!Number.isFinite(signedVolumeKm3)||signedVolumeKm3<=0)process.exitCode=1;
