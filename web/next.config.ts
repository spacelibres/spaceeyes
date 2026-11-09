import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  async rewrites() {
    return { beforeFiles: [
      { source: "/assets/planets/:body/:file", destination: "/api/_buffered-assets/planets/:body/:file" },
      { source: "/assets/planet-rings/:file", destination: "/api/_buffered-assets/rings/:file" },
      { source: "/assets/deep-space/:file", destination: "/api/_buffered-assets/galaxy/:file" },
      { source: "/api/starfield/:file", destination: "/api/_buffered-assets/stars/:file" },
    ], afterFiles: [], fallback: [] };
  },
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
