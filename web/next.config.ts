import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), ".."),
  outputFileTracingExcludes: {
    "/*": ["./.cache/**/*", "../validation/.cache/**/*"],
  },
  // Model conversion resolves this codec dynamically, so Next cannot infer it.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@loaders.gl/textures/package.json",
      "./node_modules/@loaders.gl/textures/dist/index.cjs",
      "./node_modules/@loaders.gl/textures/dist/libs/basis_encoder.*",
      "./node_modules/draco3dgltf/*.wasm",
    ],
  },
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
