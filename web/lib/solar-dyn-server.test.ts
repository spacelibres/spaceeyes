import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchSolarDyn } from "./solar-dyn-server.ts";
import { decodeDyn } from "../../platform/dyn-decoder.ts";
import { readFile } from "node:fs/promises";
import { evaluateOrb } from "../../platform/dyn-evaluator.ts";
import type { DynSelection } from "./reviewed-dyn-window.ts";
import {eyesDefinitions} from "../../platform/eyes-catalog.ts";

// v2 definition contains an index, while its child starts at flag/count, not version.
function fixtures() {
  const definition = new Uint8Array(44);
  const view = new DataView(definition.buffer);
  view.setInt16(0, 2, true);
  definition.set([111, 114, 98, 0, 3], 2);
  view.setFloat64(7, 4902, true);
  view.setFloat64(15, 398600, true);
  view.setInt32(24, 2, true);
  view.setFloat64(28, 0, true);
  view.setFloat64(36, 10, true);
  const child = new Uint8Array(5 + 2 * 72);
  const values = new DataView(child.buffer);
  child[0] = 1;
  values.setInt32(1, 2, true);
  for (const [index, time] of [0, 10].entries()) {
    [time, 384000, 0.05, 0.0000026, 0, 1, 0, 0, 0].forEach((x, field) =>
      values.setFloat64(5 + index * 72 + field * 8, x, true),
    );
  }
  return { definition, child };
}
const signal = () => new AbortController().signal;

test("last declared covered position track wins overlaps and excluded phases are never fetched",async()=>{
 const old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[
   {type:"dynamo",url:"moon/earth/first",coverage:[0,10]},
   {type:"dynamo",url:"moon/earth/second",coverage:[5,8]},
 ];
 const {definition,child}=fixtures();
 const requests:string[]=[];
 const fetcher=async(input:RequestInfo|URL)=>{
   requests.push(String(input));
   return new Response(String(input).endsWith("def.dyn")?definition:child);
 };
 try {
   for(const epoch of [4,5,8,9,5]) {
     requests.length=0;
     await fetchSolarDyn("moon",epoch,signal(),fetcher);
     assert.ok(requests.every(url=>url.includes(epoch>=5&&epoch<=8?"/second/":"/first/")),requests.join("\n"));
   }
   requests.length=0;
   await assert.rejects(fetchSolarDyn("moon",11,signal(),fetcher),/Outside source controller coverage/);
   assert.equal(requests.length,0);
 }finally{eyesDefinitions.moon.controllers=old;}
});

test("reviewed Venus and Mars source windows load modern states without weakening the decoder", async () => {
  for (const id of ["venus", "mars"]) {
    const raw = new Uint8Array(
      await readFile(
        new URL(`./fixtures/${id}-orb-anomaly.dyn`, import.meta.url),
      ),
    );
    assert.throws(() => decodeDyn(raw), /sample times must increase/);
    const bytes = await fetchSolarDyn(
      id,
      846619861.46,
      signal(),
      async () => new Response(raw),
    );
    const d = decodeDyn(bytes);
    assert.equal(d.kind, "inline");
    assert.ok(d.coverage.start < 846619861.46 && d.coverage.end > 846619861.46);
  }
});

test("reviewed windows preserve source records and expose their exact selection", async () => {
  for (const id of ["venus", "mars"]) {
    const raw = new Uint8Array(
      await readFile(
        new URL(`./fixtures/${id}-orb-anomaly.dyn`, import.meta.url),
      ),
    );
    let selected: DynSelection | undefined;
    const bytes = await fetchSolarDyn(
      id,
      846619861.46,
      signal(),
      async () => new Response(raw),
      "orb",
      (value) => {
        selected = value;
      },
    );
    assert.ok(selected);
    assert.deepEqual(
      bytes.subarray(28),
      raw.subarray(
        28 + selected.records[0] * 72,
        28 + selected.records[1] * 72,
      ),
    );
    assert.match(selected.sourceSha256, /^[a-f0-9]{64}$/);
    const d = decodeDyn(bytes);
    assert.deepEqual([d.coverage.start, d.coverage.end], selected.coverage);
    for (const t of [d.coverage.start, 846619861.46, d.coverage.end])
      assert.ok(evaluateOrb(d, t).every(Number.isFinite));
    const changed = raw.slice();
    changed[36] ^= 1;
    await assert.rejects(
      fetchSolarDyn(
        id,
        846619861.46,
        signal(),
        async () => new Response(changed),
      ),
      /sample times must increase/,
    );
  }
});

test("Venus duplicate boundary is covered on both sides; ambiguous Mars history remains rejected", async () => {
  const venus = new Uint8Array(
    await readFile(
      new URL("./fixtures/venus-orb-anomaly.dyn", import.meta.url),
    ),
  );
  for (const t of [
    -3155716758.816, -16495135.817, -16495135.816, -16495135.815,
    3155716869.184,
  ]) {
    const d = decodeDyn(
      await fetchSolarDyn(
        "venus",
        t,
        signal(),
        async () => new Response(venus),
      ),
    );
    assert.ok(evaluateOrb(d, t).every(Number.isFinite));
  }
  const mars = new Uint8Array(
    await readFile(new URL("./fixtures/mars-orb-anomaly.dyn", import.meta.url)),
  );
  await assert.rejects(
    fetchSolarDyn("mars", -5e8, signal(), async () => new Response(mars)),
    /ambiguous historical interval/,
  );
  const early = decodeDyn(
    await fetchSolarDyn("mars", -2e9, signal(), async () => new Response(mars)),
  );
  assert.ok(evaluateOrb(early, -2e9).every(Number.isFinite));
});

test("Moon index resolves a headerless child and preserves the definition metadata", async () => {
  const { definition, child } = fixtures();
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    return new Response(path.endsWith("/def.dyn") ? definition : child);
  };
  const decoded = decodeDyn(await fetchSolarDyn("moon", 5, signal(), fetcher));
  assert.deepEqual(paths, [
    "/assets/dynamic/dynamo/moon/earth/orb/def.dyn",
    "/assets/dynamic/dynamo/moon/earth/orb/000.dyn",
  ]);
  assert.equal(decoded.kind, "inline");
  assert.equal(decoded.type, "orb");
  assert.equal(decoded.gravitationalParameter1, 4902);
  assert.deepEqual(decoded.coverage, { start: 0, end: 10 });
});

test("coverage rejection stops before requesting a child", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(fixtures().definition);
  };
  await assert.rejects(
    fetchSolarDyn("moon", 11, signal(), fetcher),
    /Outside source coverage/,
  );
  assert.equal(calls, 1);
});

test("request cancellation is passed to the upstream fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher: typeof fetch = async (_input, init) => {
    assert.ok(init?.signal?.aborted);
    init.signal.throwIfAborted();
    throw Error("unreachable");
  };
  await assert.rejects(fetchSolarDyn("moon", 5, controller.signal, fetcher), {
    name: "AbortError",
  });
});

test("unknown objects, origin-only Sun and nonfinite epochs never fetch", async () => {
  const fetcher: typeof fetch = async () => {
    throw Error("unexpected network");
  };
  for (const [id, epoch] of [
    ["unknown", 5],
    ["sun", 5],
    ["moon", NaN],
  ] as const)
    await assert.rejects(
      fetchSolarDyn(id, epoch, signal(), fetcher),
      /Invalid solar resource/,
    );
});
import { reviewedMissionWindow } from "./reviewed-mission-window.ts";
test("reviewed Voyager positions preserve raw source and exclude exact duplicate terminator", async () => {
  for (const [id, track] of [
    ["sc_voyager_1", "sun/3"],
    ["sc_voyager_2", "sun/5"],
  ]) {
    const raw = new Uint8Array(
      await readFile(
        new URL(`./fixtures/${id}-pos-anomaly.dyn`, import.meta.url),
      ),
    );
    assert.throws(() => decodeDyn(raw), /sample times must increase/);
    const selected = reviewedMissionWindow(`${id}/${track}`, raw);
    assert.ok(selected.selection);
    const d = decodeDyn(selected.bytes);
    assert.equal(d.type, "pos");
    assert.equal(d.coverage.end, 3155716800);
    assert.deepEqual(selected.bytes.subarray(12), raw.subarray(12, -56));
    const mutated = raw.slice();
    mutated[20] ^= 1;
    assert.equal(
      reviewedMissionWindow(`${id}/${track}`, mutated).selection,
      undefined,
    );
  }
});

test("Juno flyby chooses the last data-covered track instead of inferring coverage from URL parent", async () => {
  const urls: string[] = [];
  const epoch=676350000;
  const {definition,child}=fixtures();
  await fetchSolarDyn(
      "sc_juno",
      epoch,
      new AbortController().signal,
      async (input) => {
        urls.push(String(input));
        const bytes=new Uint8Array(172),v=new DataView(bytes.buffer);
        bytes.set(definition.slice(0,23));bytes.set(child,23);
        const covered=String(input).includes("/ganymede/");
        for(let i=0;i<2;i++)v.setFloat64(28+i*72,epoch+(covered?-5:100)+i*10,true);
        return new Response(bytes);
      },
  );
  assert.equal(urls.length,4);
  assert.match(urls[0], /sc_juno\/io\/2\/orb/);
  assert.match(urls.at(-1)!, /sc_juno\/ganymede\/orb/);
});

test("a later position track failure is not silently replaced with an earlier orbit",async()=>{
 const old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a"},{type:"dynamo",url:"moon/other/b"}];
 const requests:string[]=[];
 try {
   await assert.rejects(fetchSolarDyn("moon",5,signal(),async input=>{
     requests.push(String(input));return new Response("",{status:503});
   }),/HTTP 503/);
   assert.equal(requests.length,1);
   assert.match(requests[0],/moon\/other\/b/);
 }finally{eyesDefinitions.moon.controllers=old;}
});

test("resolved root coverage exposes cache expiry when a later track overlaps an earlier broad payload",async()=>{
 const old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a"},{type:"dynamo",url:"moon/other/b"}];
 const {definition,child}=fixtures();
 const fetcher=async(input:RequestInfo|URL)=>{
   const later=String(input).includes("/other/b/"),bytes=new Uint8Array(172);
   bytes.set(definition.slice(0,23));bytes.set(child,23);
   const v=new DataView(bytes.buffer);
   for(let i=0;i<2;i++)v.setFloat64(28+i*72,(later?5:0)+i*(later?3:10),true);
   return new Response(bytes);
 };
 try {
   for(const epoch of [4,5,8,9]) {
     let selection:any;
     await fetchSolarDyn("moon",epoch,signal(),fetcher,"orb",undefined,value=>{selection=value;});
     assert.equal(selection.track,epoch>=5&&epoch<=8?"moon/other/b":"moon/earth/a");
     if(epoch===4)assert.equal(selection.upperExclusive,5);
     if(epoch===9)assert.equal(selection.lowerExclusive,8);
   }
 }finally{eyesDefinitions.moon.controllers=old;}
});

test("an internal index-gap start remains inclusive for the fallback cache domain",async()=>{
 const old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a"},{type:"dynamo",url:"moon/earth/b"}];
 const {definition,child}=fixtures();
 const gap=new Uint8Array(59),v=new DataView(gap.buffer);
 v.setInt16(0,1,true);gap.set([111,114,98,0],2);v.setFloat64(6,4902,true);v.setFloat64(14,398600,true);v.setInt32(23,2,true);
 [0,5,7,10].forEach((x,i)=>v.setFloat64(27+i*8,x,true));
 try {
   let selection:any;
   await fetchSolarDyn("moon",5,signal(),async input=>{
     if(String(input).includes("/b/"))return new Response(gap);
     const bytes=new Uint8Array(172);bytes.set(definition.slice(0,23));bytes.set(child,23);return new Response(bytes);
   },"orb",undefined,value=>{selection=value;});
   assert.equal(selection.lowerInclusive,5);
   assert.equal(selection.upperExclusive,7);
 }finally{eyesDefinitions.moon.controllers=old;}
});

test("real hash-pinned Juno flyby resolves after later duplicate-terminator sources prove outside coverage",async()=>{
 const sources=JSON.parse(await readFile(new URL('../../docs/evidence/controllers-0.0.71/juno-reviewed-sources.json',import.meta.url),'utf8')).sources;
 const fixturesByTrack=new Map<string,Uint8Array<ArrayBuffer>>();
 for(const source of sources)fixturesByTrack.set(source.track,new Uint8Array(await readFile(new URL(`./fixtures/${source.fixture.split('/').at(-1)}`,import.meta.url))));
 const tracks:string[]=[];
 let selection:DynSelection|undefined,controller:any;
 const bytes=await fetchSolarDyn("sc_juno",676350000,signal(),async input=>{
   const track=String(input).split('/dynamo/')[1].replace('/def.dyn','');tracks.push(track);
   assert.ok(fixturesByTrack.has(track),track);return new Response(fixturesByTrack.get(track)!);
 },"orb",value=>{selection=value;},value=>{controller=value;});
 assert.deepEqual(tracks,["sc_juno/io/2/orb","sc_juno/io/1/orb","sc_juno/europa/orb","sc_juno/ganymede/orb"]);
 assert.equal(controller.track,"sc_juno/ganymede/orb");
 assert.equal(controller.upperExclusive,717700360);
 assert.deepEqual(selection?.records,[0,8]);
 assert.deepEqual(decodeDyn(bytes).coverage,{start:676339597,end:676381521});
});

test("known reviewed mission coverage outside is distinct from malformed or ambiguous payload failure",async()=>{
 const old=eyesDefinitions.moon.controllers;
 eyesDefinitions.moon.controllers=[{type:"dynamo",url:"moon/earth/a"},{type:"dynamo",url:"sc_osiris_rex/sun/4/orb"}];
 const raw=new Uint8Array(await readFile(new URL('./fixtures/sc_osiris_rex__sun__4__orb__def-source.dyn',import.meta.url)));
 const epoch=748838793,{definition,child}=fixtures();let controller:any;
 try {
   await fetchSolarDyn("moon",epoch,signal(),async input=>{
     if(String(input).includes("/sc_osiris_rex/"))return new Response(raw);
     const bytes=new Uint8Array(172);bytes.set(definition.slice(0,23));bytes.set(child,23);
     const v=new DataView(bytes.buffer);for(let i=0;i<2;i++)v.setFloat64(28+i*72,epoch-10+i*20,true);
     return new Response(bytes);
   },"orb",undefined,value=>{controller=value;});
   assert.equal(controller.track,"moon/earth/a");
   assert.ok(controller.upperExclusive>epoch);
 }finally{eyesDefinitions.moon.controllers=old;}
});
import missionPolicies from "./reviewed-mission-policies.json" with { type: "json" };
test("all hash-pinned mission windows preserve contiguous original records and strict decoding", async () => {
  for (const [key, p] of Object.entries(missionPolicies)) {
    const raw = new Uint8Array(
      await readFile(new URL(`./fixtures/${p.fixture}`, import.meta.url)),
    );
    assert.throws(() => decodeDyn(raw));
    const split = key.lastIndexOf("/"),
      track = key.slice(0, split),
      name = key.slice(split + 1);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (const [start, end] of p.windows) {
      const epoch =
        (view.getFloat64(p.base + start * p.stride, true) +
          view.getFloat64(p.base + (end - 1) * p.stride, true)) /
        2;
      const selected = reviewedMissionWindow(track, raw, epoch, name);
      assert.ok(selected.selection);
      decodeDyn(selected.bytes);
      assert.deepEqual(
        selected.bytes.subarray(p.base),
        raw.subarray(p.base + start * p.stride, p.base + end * p.stride),
      );
    }
    const changed = raw.slice();
    changed[changed.length - 1] ^= 1;
    assert.equal(
      reviewedMissionWindow(track, changed, 846620500, name).selection,
      undefined,
    );
  }
});

test("single orientation root exposes precise coverage rather than treating network errors as absence", async()=>{
 const {OrientationOutsideCoverage}=await import("./solar-dyn-server.ts");
 const bytes=new Uint8Array(140),v=new DataView(bytes.buffer);
 v.setInt16(0,2,true);bytes.set([111,114,105,0,3,1],2);v.setInt32(8,2,true);
 for(let i=0;i<2;i++) [100+i*10,1,0,0,0,0,0,0].forEach((n,j)=>v.setFloat64(12+i*64+j*8,n,true));
 await assert.rejects(()=>fetchSolarDyn("sc_psyche",5,signal(),async()=>new Response(bytes),"ori"),error=>error instanceof OrientationOutsideCoverage && error.coverage[0]===100 && error.coverage[1]===110);
 await assert.rejects(()=>fetchSolarDyn("sc_psyche",5,signal(),async()=>new Response("",{status:503}),"ori"),error=>!(error instanceof OrientationOutsideCoverage));
});

test("hash-pinned NASA LRO and Psyche quat index/children decode offline with actual wire headers",async()=>{
 const {createHash}=await import("node:crypto");
 const {evaluateOri}=await import("../../platform/dyn-evaluator.ts");
 for(const id of ["sc_psyche","sc_lunar_reconnaissance_orbiter"]) {
  const metadata=JSON.parse(await readFile(new URL("./fixtures/quat/"+id+".json",import.meta.url),"utf8"));
  const definition=new Uint8Array(await readFile(new URL("./fixtures/quat/"+id+"-def.dyn",import.meta.url)));
  const child=new Uint8Array(await readFile(new URL("./fixtures/quat/"+id+"-"+metadata.child+".dyn",import.meta.url)));
  assert.equal(createHash("sha256").update(definition).digest("hex"),metadata.sha256.definition);
  assert.equal(createHash("sha256").update(child).digest("hex"),metadata.sha256.child);
  const requests:string[]=[];
  const nodes=new Map<string,Uint8Array<ArrayBuffer>>();
  for(const node of metadata.nodes??[{name:metadata.child,sha256:metadata.sha256.child}]) {
    const raw=new Uint8Array(await readFile(new URL("./fixtures/quat/"+id+"-"+node.name+".dyn",import.meta.url)));
    assert.equal(createHash("sha256").update(raw).digest("hex"),node.sha256);nodes.set(node.name,raw);
  }
  const bytes=await fetchSolarDyn(id,metadata.epoch,signal(),async input=>{const url=String(input);requests.push(url);return new Response(url.endsWith("/def.dyn")?definition:nodes.get(url.split("/").at(-1)!.replace(".dyn",""))!);},"ori");
  assert.equal(requests.length,nodes.size+1);assert.ok(requests.at(-1)!.endsWith("/"+metadata.child+".dyn"));
  assert.deepEqual(Array.from(bytes.slice(0,8)),Array.from(definition.slice(0,8)));
  const d=decodeDyn(bytes);assert.equal(d.sourceType,"quat");assert.equal(d.type,"ori");
  assert.ok(Math.abs(Math.hypot(...evaluateOri(d,metadata.epoch))-1)<1e-12);
  if(d.kind!=="inline"||d.type!=="ori")throw Error("Expected attitude");
  assert.ok(d.records.every(r=>r.angularVelocity.every(v=>v===0)));
 }
});

test("reviewed Psyche quat windows retain both sides but reject conflicting duplicate epoch",async()=>{
 const id="sc_psyche",meta=JSON.parse(await readFile(new URL("./fixtures/quat/"+id+".json",import.meta.url),"utf8"));
 const definition=new Uint8Array(await readFile(new URL("./fixtures/quat/"+id+"-def.dyn",import.meta.url)));
 const child=new Uint8Array(await readFile(new URL("./fixtures/quat/"+id+"-"+meta.child+".dyn",import.meta.url)));
 const raw=new Uint8Array(8+child.length);raw.set(definition.slice(0,8));raw.set(child,8);
 assert.throws(()=>decodeDyn(raw),/sample times must increase/);
 const v=new DataView(child.buffer,child.byteOffset,child.byteLength);
 const q=(i:number)=>Array.from({length:4},(_,j)=>v.getFloat64(5+i*40+8+j*8,true));
 const a=q(3),b=q(4),dot=Math.abs(a.reduce((sum,n,i)=>sum+n*b[i],0)/(Math.hypot(...a)*Math.hypot(...b)));
 assert.ok(1-dot>1e-12,"duplicate attitudes are not sign-equivalent");
 const fetcher:typeof fetch=async input=>new Response(String(input).endsWith("/def.dyn")?definition:child);
 const later=decodeDyn(await fetchSolarDyn(id,846756077,signal(),fetcher,"ori"));assert.equal(later.type,"ori");
 await assert.rejects(()=>fetchSolarDyn(id,846755939.6190909,signal(),fetcher,"ori"),/Ambiguous/);
 const changed=child.slice();changed[20]^=1;
 await assert.rejects(()=>fetchSolarDyn(id,meta.epoch,signal(),async input=>new Response(String(input).endsWith("/def.dyn")?definition:changed),"ori"),/sample times must increase/);
});
test('Mars2020 duplicate landing records retain exact contiguous pre/post windows',async()=>{
 const raw=new Uint8Array(await readFile(new URL('./fixtures/sc_mars_2020__surface__lin__0000-source.dyn',import.meta.url)));
 assert.throws(()=>decodeDyn(raw),/sample times must increase/);
 for(const [epoch,range] of [[666953097.003,[0,145]],[666953099.003,[254,257]]] as const){
 const x=reviewedMissionWindow('sc_mars_2020/surface/lin',raw,epoch,'0000');
 assert.deepEqual(x.selection?.records,range);decodeDyn(x.bytes);
 assert.deepEqual(x.bytes.subarray(12),raw.subarray(12+range[0]*32,12+range[1]*32));
 }
});
test('InSight EDL identical final terminator selects original ordered records only',async()=>{
 const raw=new Uint8Array(await readFile(new URL('./fixtures/sc_insight_edl__mars__pos__def-source.dyn',import.meta.url)));
 assert.throws(()=>decodeDyn(raw),/sample times must increase/);
 const x=reviewedMissionWindow('sc_insight_edl/mars/pos',raw,596533601);
 assert.deepEqual(x.selection?.records,[0,183]);decodeDyn(x.bytes);
 const changed=raw.slice();changed[changed.length-1]^=1;
 assert.equal(reviewedMissionWindow('sc_insight_edl/mars/pos',changed,596533601).selection,undefined);
});
