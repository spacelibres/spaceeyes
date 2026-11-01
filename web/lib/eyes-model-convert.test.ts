import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeIO } from "@gltf-transform/core";
import {
  convertEyesModel,
  selectEyesModelImages,
} from "./eyes-model-convert.ts";

test("model conversion keeps geometry and bakes the declared local km transform into each scene", async () => {
  const json: any = {
    asset: { version: "2.0" },
    buffers: [{ uri: "mesh.bin", byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const binary = new Uint8Array(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
  );
  const output = await convertEyesModel(
    json,
    { "mesh.bin": binary },
    { rotate: [{ x: 90 }], translate: [1, 2, 3] },
  );
  const doc = await new NodeIO().readBinary(output);
  const root = doc.getRoot().listScenes()[0].listChildren()[0];
  assert.deepEqual(root.getScale(), [0.001, 0.001, 0.001]);
  assert.deepEqual(root.getTranslation(), [1, 3, -2]);
  assert.equal(
    doc
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute("POSITION")!
      .getCount(),
    3,
  );
  assert.ok(output.byteLength > 36);
});

test("phase conversion replaces rotation, hides named descendant geometry and retains joints and shared meshes",async()=>{
 const input:any={asset:{version:"2.0"},buffers:[{uri:"mesh.bin",byteLength:36}],
   bufferViews:[{buffer:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3",min:[0,0,0],max:[1,1,0]}],
   meshes:[{primitives:[{attributes:{POSITION:0}}]}],
   nodes:[{name:"Root",children:[1,3]},{name:"Probe",children:[2]},{name:"ProbeJoint",mesh:0},{name:"Visible",mesh:0}],
   scenes:[{nodes:[0]}],scene:0};
 const resources={"mesh.bin":new Uint8Array(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer)};
 const output=await convertEyesModel(input,resources,{rotate:[{z:90}],rotationWxyz:[Math.SQRT1_2,Math.SQRT1_2,0,0],translate:[0,0,.001]},["Probe","Absent"]);
 const doc=await new NodeIO().readBinary(output),nodes=doc.getRoot().listNodes();
 const frame=doc.getRoot().listScenes()[0].listChildren()[0];
 assert.ok(frame.getRotation().every((x,i)=>Math.abs(x-(i===3?1:0))<1e-7),"absolute +90X and core basis -90X cancel, original Z rotation is replaced");
 assert.deepEqual(frame.getTranslation(),[0,.001,0]);
 assert.equal(Boolean(nodes.find(n=>n.getName()==="ProbeJoint")!.getMesh()),false);
 assert.ok(nodes.find(n=>n.getName()==="Visible")!.getMesh(),"shared mesh remains on visible sibling");
 assert.ok(nodes.find(n=>n.getName()==="Probe")!.listChildren().some(n=>n.getName()==="ProbeJoint"),"hidden joint hierarchy retained");
 const restored=await new NodeIO().readBinary(await convertEyesModel(input,resources,{}));
 assert.ok(restored.getRoot().listNodes().find(n=>n.getName()==="ProbeJoint")!.getMesh(),"a different phase starts from unchanged source geometry");
 assert.equal(input.nodes[2].mesh,0);
 input.nodes[1].name="Probe.Name";
 const sanitized=await new NodeIO().readBinary(await convertEyesModel(input,resources,{},["ProbeName"]));
 assert.equal(Boolean(sanitized.getRoot().listNodes().find(n=>n.getName()==="ProbeJoint")!.getMesh()),false,
   "NASA GLTFLoader object-name sanitization is used for matching, without renaming joints");
});

test("WebP and Basis texture selection excludes unused fallback images without guessing replacement URLs", () => {
  const json = selectEyesModelImages({
    materials: [
      {
        normalTexture: { index: 0 },
        pbrMetallicRoughness: { baseColorTexture: { index: 1 } },
      },
    ],
    images: [
      { uri: "unavailable.jpg" },
      { uri: "primary.webp" },
      { uri: "primary.ktx2" },
    ],
    textures: [
      { source: 0, extensions: { EXT_texture_webp: { source: 1 } } },
      { source: 0, extensions: { KHR_texture_basisu: { source: 2 } } },
    ],
  });
  assert.deepEqual(json.images, [
    { uri: "primary.webp" },
    { uri: "primary.ktx2" },
  ]);
  assert.deepEqual(
    json.textures.map((t: any) => t.source),
    [0, 1],
  );
});

test("unused exporter texture slots are ignored while invalid referenced images fail explicitly", () => {
  const input = {
    materials: [{ normalTexture: { index: 0 } }],
    images: [{ uri: "real.png" }],
    textures: [{ source: 0 }, { source: 99 }],
  };
  assert.equal(selectEyesModelImages(input).textures.length, 1);
  assert.throws(
    () =>
      selectEyesModelImages({
        ...input,
        materials: [{ normalTexture: { index: 1 } }],
      }),
    /Invalid referenced model image/,
  );
});
