import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import draco from 'draco3dgltf';
import {vec3} from 'gl-matrix';
import {EyesAssetService} from '../lib/eyes-assets.ts';
import {eyesDependencies} from '../../platform/eyes-catalog.ts';
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import originalModels from '../../validation/eyes-models.json' with {type:'json'};
import parentModels from '../../validation/eyes-parent-models.json' with {type:'json'};
import originalDependencies from '../../validation/eyes-dependencies.json' with {type:'json'};
import parentDependencies from '../../validation/eyes-parent-dependencies.json' with {type:'json'};
const service=new EyesAssetService({cacheDirectory:fileURLToPath(new URL('../.cache/eyes-assets',import.meta.url))});
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco.createDecoderModule()});
const entries:Record<string,unknown>={};
const sources=[...originalModels.rows,...parentModels.rows];
const dependencies:Record<string,{sha256:string}>={...originalDependencies.files,...parentDependencies.files};
for(const host of eyesDependencies.filter(body=>body.model)) {
 const asset=await service.get(host.id,'model.glb'),doc=await io.readBinary(asset.bytes);
 let radius2=0,vertices=0;const point:number[]=[0,0,0];
 for(const scene of doc.getRoot().listScenes())scene.traverse(node=>{
  if(node.getSkin())throw Error('Animated/skinned framing requires an explicit source envelope');
  const mesh=node.getMesh();if(!mesh)return;const matrix=node.getWorldMatrix();
  for(const primitive of mesh.listPrimitives()) {
   if(primitive.listTargets().length)throw Error('Morph framing requires an explicit source envelope');
   const positions=primitive.getAttribute('POSITION');if(!positions)throw Error('Missing positions');
   for(let i=0;i<positions.getCount();i++) {
    positions.getElement(i,point);vec3.transformMat4(point,point,matrix);radius2=Math.max(radius2,vec3.squaredLength(point));vertices++;
   }
  }
 });
 if(!vertices||!Number.isFinite(radius2)||radius2<=0)throw Error('Invalid framing radius');
 const url=host.model!.url.replace('$STATIC_ASSETS_URL','https://eyes.nasa.gov/assets/static');
 const source=sources.find(row=>row.url===url);if(!source?.sha256)throw Error('Missing source model pin');
 const geometrySources:Record<string,string>={[url]:source.sha256};
 for(const buffer of source.buffers??[]) {
  const uri=new URL(buffer.uri,url).href,pin=dependencies[uri];if(!pin)throw Error('Missing geometry dependency pin');
  geometrySources[uri]=pin.sha256;
 }
 entries[host.id]={model:host.model,radiusKm:Math.max(host.radiusKm,Math.sqrt(radius2)),convertedSha256:asset.sha256,vertices,geometrySources};
}
const converterSha256=createHash('sha256').update(await readFile(new URL('../lib/eyes-model-convert.ts',import.meta.url))).digest('hex');
await writeFile(new URL('../../validation/eyes-parent-framing.json',import.meta.url),JSON.stringify({source:'Audited NASA reference-host converted geometry in km, centered on original entity origin; 2026-11-03',converterSha256,entries},null,2)+'\n');
console.log('Verified model framing envelopes:',Object.keys(entries).length);
