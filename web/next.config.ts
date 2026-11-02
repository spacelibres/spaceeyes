import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  serverExternalPackages: [
    "@gltf-transform/core",
    "@gltf-transform/extensions",
    "draco3dgltf",
    "sharp",
    "@loaders.gl/textures",
    "gl-matrix",
    "three",
  ],
};
export default config;
