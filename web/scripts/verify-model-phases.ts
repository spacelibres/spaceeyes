import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {NodeIO} from "@gltf-transform/core";
import {ALL_EXTENSIONS} from "@gltf-transform/extensions";
import {EyesAssetService} from "../lib/eyes-assets.ts";
import {eyesModelLookupName} from "../lib/eyes-model-convert.ts";
import {eyesModelVariants} from "../../platform/eyes-model-phases.ts";
import config from "../../platform/eyes-model-phases.json" with {type:"json"};

// Optional real-resource check, separate from offline tests and GPU evidence.
const root=fileURLToPath(new URL("../../",import.meta.url));
const output=join(root,"docs/evidence/model-phases-0.0.72");
const service=new EyesAssetService({cacheDirectory:join(root,"web/.cache/eyes-assets")});
const jobs=[...new Set(config.actions.map(action=>action.entity))]
  .flatMap(id=>eyesModelVariants(id).map(phase=>({id,phase})));
const results:Record<string,unknown>[]=[];
let next=0;
await Promise.all(Array.from({length:2},async()=>{
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
  while(next<jobs.length){
    const {id,phase}=jobs[next++];
    const start=Date.now();
    try {
      const asset=await service.get(id,`model-${phase.key}.glb`);
      const doc=await io.readBinary(asset.bytes);
      const hidden=phase.hiddenNodes.map(name=>{
        const node=doc.getRoot().listNodes().find(node=>node.getName()===name||eyesModelLookupName(node.getName())===name);
        let meshes=0;
        node?.traverse(child=>{if(child.getMesh())meshes++;});
        assert.equal(meshes,0,`${id}/${phase.key}/${name} still has visible geometry`);
        return{name,matched:Boolean(node)};
      });
      const geometry=doc.getRoot().listNodes().filter(node=>node.getMesh()).length;
      const scenes=doc.getRoot().listScenes();
      assert.ok(scenes.length>0);
      results.push({id,phase:phase.key,source:phase.model.url,success:true,bytes:asset.bytes.length,
        sha256:asset.sha256,wallMs:Date.now()-start,geometry,hidden,
        frame:scenes[0].listChildren().map(node=>({rotation:node.getRotation(),translation:node.getTranslation(),scale:node.getScale()}))});
    }catch(error){results.push({id,phase:phase.key,source:phase.model.url,success:false,error:String(error)});}
  }
}));
results.sort((a,b)=>String(a.id).localeCompare(String(b.id))||String(a.phase).localeCompare(String(b.phase)));
await mkdir(output,{recursive:true});
await writeFile(join(output,"converted-variants.json"),JSON.stringify(results,null,2)+"\n");
console.log(JSON.stringify({variants:jobs.length,passed:results.filter(result=>result.success).length,
  failed:results.filter(result=>!result.success)},null,2));
if(results.some(result=>!result.success))process.exitCode=1;
