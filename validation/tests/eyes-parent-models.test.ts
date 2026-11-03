import {test} from "node:test";
import assert from "node:assert/strict";
import {eyesDependencies} from "../../platform/eyes-catalog.ts";
import original from "../eyes-models.json" with {type:"json"};
import parents from "../eyes-parent-models.json" with {type:"json"};
import dependencies from "../eyes-parent-dependencies.json" with {type:"json"};
import originalDependencies from "../eyes-dependencies.json" with {type:"json"};
import framing from "../eyes-parent-framing.json" with {type:"json"};
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

test("every modeled reference host has a locked model and complete source dependencies",()=>{
 const rows=[...original.rows,...parents.rows];
 const pins=dependencies.files as Record<string,{sha256:string;bytes:number}>;
 assert.equal(parents.total,parents.rows.length);
 assert.equal(new Set(parents.rows.map(row=>row.url)).size,parents.rows.length);
 for(const host of eyesDependencies.filter(body=>body.model)) {
  const url=host.model!.url.replace("$STATIC_ASSETS_URL","https://eyes.nasa.gov/assets/static");
  assert.ok(rows.some(row=>row.url===url&&row.ok&&row.sha256),`${host.id} missing model pin`);
 }
 for(const row of parents.rows) {
  assert.equal(pins[row.url]?.sha256,row.sha256);
  assert.equal(pins[row.url]?.bytes,row.bytes);
  for(const ref of [...row.buffers,...row.images]) {
   const url=new URL(ref.uri,row.url);
   assert.equal(url.origin,"https://eyes.nasa.gov");
   assert.ok(url.pathname.startsWith("/assets/static/"));
   const pin=pins[url.href];
   assert.ok(pin&&/^[a-f0-9]{64}$/.test(pin.sha256),url.href);
   assert.ok(pin.bytes>0&&pin.bytes<=64*1024**2,url.href);
   if("bytes" in ref)assert.equal(pin.bytes,ref.bytes);
  }
 }
});
test("reference-host framing stays tied to the audited converter, source bytes and transform",async()=>{
 assert.equal(framing.converterSha256,createHash('sha256').update(await readFile(new URL('../../web/lib/eyes-model-convert.ts',import.meta.url))).digest('hex'));
 const pins:Record<string,{sha256:string}>={...originalDependencies.files,...dependencies.files};
 for(const row of [...original.rows,...parents.rows])if(row.sha256)pins[row.url]={sha256:row.sha256};
 for(const host of eyesDependencies.filter(body=>body.model)) {
  const row=(framing.entries as Record<string,{model:unknown;radiusKm:number;geometrySources:Record<string,string>}>)[host.id];
  assert.ok(row,host.id);assert.deepEqual(row.model,host.model);
  assert.ok(Number.isFinite(row.radiusKm)&&row.radiusKm>=host.radiusKm);
  const modelUrl=host.model!.url.replace('$STATIC_ASSETS_URL','https://eyes.nasa.gov/assets/static');
  const model=[...original.rows,...parents.rows].find(candidate=>candidate.url===modelUrl);
  assert.ok(model,modelUrl);
  assert.deepEqual(Object.keys(row.geometrySources).sort(),[modelUrl,...model.buffers.map(buffer=>new URL(buffer.uri,modelUrl).href)].sort());
  for(const [url,hash]of Object.entries(row.geometrySources))assert.equal(pins[url]?.sha256,hash,url);
 }
});
