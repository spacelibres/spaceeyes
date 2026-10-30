declare module "draco3dgltf" {
  const draco: { createDecoderModule(): Promise<unknown> };
  export default draco;
}
