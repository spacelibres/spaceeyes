/// <reference path="../types/draco3dgltf.d.ts" />
import { NodeIO, type JSONDocument } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco from "draco3dgltf";
import sharp from "sharp";
import { quat } from "gl-matrix";
import { dirname, join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

type SourceVector = { constructor: string; values: number[] };
export type ModelTransform = {
  scale?: number | number[] | SourceVector;
  rotate?: Record<string, number>[];
  translate?: number[] | SourceVector;
};
const nativeRequire = process
  .getBuiltinModule("node:module")
  .createRequire(import.meta.url);
let basisPromise: Promise<any> | undefined;
let ioPromise: Promise<NodeIO> | undefined;

async function basisModule() {
  basisPromise ??= (async () => {
    // Official, npm-pinned UMD codec. Copy unchanged to .cjs so Node treats the vendor wrapper correctly.
    const source = join(
      dirname(nativeRequire.resolve("@loaders.gl/textures")),
      "libs",
    );
    const folder = resolve(process.cwd(), ".cache/eyes-codecs");
    await mkdir(folder, { recursive: true });
    const wrapper = await readFile(join(source, "basis_encoder.js"));
    const target = join(folder, "basis_encoder.cjs");
    await writeFile(target, wrapper);
    const factory = nativeRequire(target);
    const module = await factory({
      wasmBinary: await readFile(join(source, "basis_encoder.wasm")),
    });
    module.initializeBasis();
    return module;
  })();
  return basisPromise;
}

export async function decodeEyesKtx2(bytes: Uint8Array): Promise<Uint8Array> {
  const { KTX2File } = await basisModule();
  const file = new KTX2File(bytes);
  try {
    if (!file.startTranscoding()) throw Error("KTX2 transcoding failed");
    const { width, height } = file.getImageLevelInfo(0, 0, 0);
    if (width < 1 || height < 1 || width * height > 8192 * 8192)
      throw Error(`KTX2 pixel budget (${width}x${height})`);
    const size = file.getImageTranscodedSizeInBytes(0, 0, 0, 13); // Basis Universal RGBA32.
    if (size !== width * height * 4) throw Error("KTX2 RGBA size mismatch");
    const rgba = new Uint8Array(size);
    if (!file.transcodeImage(rgba, 0, 0, 0, 13, 0, -1, -1))
      throw Error("KTX2 image conversion failed");
    return new Uint8Array(
      await sharp(rgba, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer(),
    );
  } finally {
    file.close();
    file.delete();
  }
}

export function selectEyesModelImages(input: Record<string, any>) {
  const json = structuredClone(input);
  const infos: { index: number }[] = [];
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        key.endsWith("Texture") &&
        child &&
        typeof child === "object" &&
        Number.isInteger((child as any).index)
      )
        infos.push(child as { index: number });
      else visit(child);
    }
  };
  visit(json.materials ?? []);
  const textureIndices = [...new Set(infos.map((info) => info.index))].sort(
    (a, b) => a - b,
  );
  const textureRemap = new Map(
    textureIndices.map((value, index) => [value, index]),
  );
  json.textures = textureIndices.map((index) => {
    if (!json.textures?.[index])
      throw Error("Invalid referenced model texture");
    return json.textures[index];
  });
  for (const info of infos) info.index = textureRemap.get(info.index)!;
  for (const texture of json.textures ?? [])
    for (const name of ["KHR_texture_basisu", "EXT_texture_webp"])
      if (texture.extensions?.[name]) {
        texture.source = texture.extensions[name].source;
        delete texture.extensions[name];
      }
  const indices = [
    ...new Set<number>(
      (json.textures ?? []).map((t: any) => t.source).filter(Number.isInteger),
    ),
  ].sort((a, b) => a - b);
  const remap = new Map(indices.map((value, index) => [value, index]));
  json.images = indices.map((index) => {
    if (!json.images?.[index]) throw Error("Invalid referenced model image");
    return json.images[index];
  });
  for (const texture of json.textures ?? [])
    if (Number.isInteger(texture.source))
      texture.source = remap.get(texture.source);
  return json;
}
export async function convertEyesModel(
  input: Record<string, any>,
  sourceResources: Record<string, Uint8Array>,
  transform: ModelTransform,
): Promise<Uint8Array> {
  const json = selectEyesModelImages(input),
    resources = { ...sourceResources };
  for (const [index, image] of (json.images ?? []).entries()) {
    if (
      image.uri &&
      (image.mimeType === "image/ktx2" || image.uri.endsWith(".ktx2"))
    ) {
      const png = await decodeEyesKtx2(resources[image.uri]);
      const name = `spaceeyes-decoded-${index}.png`;
      resources[name] = png;
      image.uri = name;
      image.mimeType = "image/png";
    }
  }
  for (const texture of json.textures ?? []) {
    for (const name of ["KHR_texture_basisu", "EXT_texture_webp"]) {
      if (texture.extensions?.[name]) {
        texture.source = texture.extensions[name].source;
        delete texture.extensions[name];
      }
    }
  }
  for (const key of ["extensionsRequired", "extensionsUsed"])
    if (json[key])
      json[key] = json[key].filter(
        (x: string) => !["KHR_texture_basisu", "EXT_texture_webp"].includes(x),
      );
  ioPromise ??= (async () =>
    new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      "draco3d.decoder": await draco.createDecoderModule(),
    }))();
  const io = await ioPromise;
  const doc = await io.readJSON({ json, resources } as JSONDocument);
  doc
    .getRoot()
    .listExtensionsUsed()
    .find((e) => e.extensionName === "KHR_draco_mesh_compression")
    ?.dispose();
  const rotation = quat.create();
  for (const step of transform.rotate ?? []) {
    const axis = Object.keys(step)[0];
    const v = axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];
    const next = quat.setAxisAngle(
      quat.create(),
      v,
      (step[axis] * Math.PI) / 180,
    );
    quat.multiply(rotation, next, rotation);
  }
  // Normalize the asset's local ICRF-axis convention, matching the core's body-local basis.
  quat.multiply(
    rotation,
    quat.setAxisAngle(quat.create(), [1, 0, 0], -Math.PI / 2),
    rotation,
  );
  const scale =
    transform.scale === undefined
      ? [0.001, 0.001, 0.001]
      : typeof transform.scale === "number"
        ? [transform.scale, transform.scale, transform.scale]
        : Array.isArray(transform.scale)
          ? transform.scale
          : transform.scale.values;
  const translation =
    transform.translate === undefined
      ? [0, 0, 0]
      : Array.isArray(transform.translate)
        ? transform.translate
        : transform.translate.values;
  if (
    scale.length !== 3 ||
    scale.some((x) => !Number.isFinite(x) || x <= 0) ||
    translation.length !== 3 ||
    !translation.every(Number.isFinite)
  )
    throw Error("Invalid model transform");
  for (const scene of doc.getRoot().listScenes()) {
    const children = scene.listChildren();
    const root = doc
      .createNode("SpaceEyes source model frame")
      .setScale(scale as [number, number, number])
      .setRotation(Array.from(rotation) as [number, number, number, number])
      .setTranslation([translation[0], translation[2], -translation[1]]);
    for (const child of children) {
      scene.removeChild(child);
      root.addChild(child);
    }
    scene.addChild(root);
  }
  return io.writeBinary(doc);
}
