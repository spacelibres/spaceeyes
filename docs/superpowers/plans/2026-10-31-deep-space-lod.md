# Deep Space Seven-Level LOD Implementation Plan

> Execute with subagent-driven-development, independent owned paths, task reviews and final integrated verification. User approved full design on 2026-10-31.

**Goal:** NASA 8K HDR-derived seven-level streamed galaxy, synchronized star LOD, physical FOV, deep blacks and real PBR IBL.

**Architecture:** TS data source + controlled SDK, Rust Bevy0.19.1 WASM, external assets. Current codex/bevy-planning only. Preserve all prior scene/camera/label features and frozen branch.

## Shared contracts (implement exactly; coordinate any needed change)

- Seven levels0..6: width128*2^level,height64*2^level. tileSize256,border2. Equirectangular ICRF/J2000, x wraps, y clamps. One source8K EXR, hash verified during preparation.
- Backend GET /api/galaxy-manifest returns schemaVersion1, source{url,sha256,bytes,width,height},tileSize256,border2,levels[{level,width,height,tiles[{x,y,assetId,path,sha256,bytes}]}],diffuse{assetId,path,sha256,bytes},specular{...}. Tile IDs galaxy:l{level}:{x}:{y}; paths deep-space/galaxy-l{level}-{x}-{y}.sehdr. IBL paths deep-space/galaxy-diffuse.sehdr and galaxy-specular.sehdr. Existing /assets/deep-space/[file] serves approved generated files, unknown rejected. Preparation is explicit offline script, never a giant first-request decode.
- .sehdr generic linear HDR image:16-byte header; bytes0..7 ASCII SEHDR01 + NUL; u16LE width at8,height at10; u8 faces at12 (1 or6),u8 mip count at13;u16LE flags at14=0. Payload mip-major, then faces(+X,-X,+Y,-Y,+Z,-Z),then top-down rows, RGBA half floatsLE.2D tiles1 mip with gutters. Cubes square/power2, diffuse32, specular128 with full roughness mip chain. Use mature external HDR/IBL tooling for generation, not a made-up GGX approximation.
- EnvironmentSpec remains {assetId,frame:'ICRF',intensity}, optional lod:{tileSize:256,border:2,levels:[{level,width,height,tiles:[{x,y,assetId}]}],diffuseAssetId,specularAssetId,exposureEv,blackLevel,iblIntensity}. Bounds exposureEv[-6,6],blackLevel[0,.02],iblIntensity[0,2]. Parent tile asset0 is assetId. Registered resource IDs only, double validation, max1024 tiles, immutable snapshots. Runtime GPU texture cap64MiB, total background target96MiB.
- StarfieldSpec optional kind:'star'|'galaxy', default star for old calls. Seven cumulative stellar source-mag limits6,6.4,6.8,7.25,7.58,7.82,8.03. Galaxies independent role. Keep source numeric values. StarfieldSource.setLod(level) loads required bins, retains bounded parsed cache; enable(true) default level6 for legacy tests. Runtime source kind from filename, not inference inside Bevy.
- Rust shared resource DeepSpaceLod owns wanted/ready/current/blend and exposure/black. Core environment_status exposes desiredLod,readyLod,currentLod,blend,loadedTiles,gpuBytes + phase/error. Galaxy and stars consume same projection/LOD blend. Host polls desiredLod for TS source loading. Avoid double-tone mapping, minimum glow floor and full-screen ambient lift.
- FOV parent RustCore.set_camera_fov(session,plugin,degrees), getter camera_fov_degrees(), WASM camera_fov(session,plugin,degrees). camera.control required,10..100 finite, default45. CorePort.cameraFov({sessionId,pluginId,degrees}); PluginContext.camera.fieldOfView(degrees). UI one observation FOV control, primary camera only. Existing orbit wheel remains physical dolly.

## Tasks / owned files

- [x] Backend resource preparation: web/lib/galaxy-hdr*.ts, offline web/scripts/prepare-galaxy-lod.*, new manifest route, existing deep-space route, validation HDR source metadata, tests. Fetch/audit8K official NASA, seven true resolutions, half-float tiles and mature-tool IBL cubes, seam/black/HDR/range tests. No runtime host or Rust edits.
- [x] Core render: core/src/deep_space.rs, deep_render.rs, sky_render.rs, starfield.rs, new hdr_assets.rs/deep_lod.rs, galaxy/starfield WGSL. Validate lod resources; load external half-float; streamed level fallback/fade/budget/release; actual EnvironmentMapLight; shared star LOD and flux; synthetic black/HDR/orientation/lifecycle tests. Tell parent required renderer/lib registrations; do not edit those files.
- [x] SDK + host/UI: platform environment/star contracts + source + adapters + tests; web/lib/solar-workspace.ts and app workspace/view sky controls. Load/validate manifest/register resources, one env request, shared status, sourceLOD updates, cancel/exit/retry, cameraFov SDK. No backend HDR service or Rust edits.
- [x] Parent integration: root Rust FOV state/API/WASM, lib.rs/renderer.rs registration/order, source defaults, integration tests, review each task and whole diff, SDK skill/spec/CHANGELOG/patch versions.
- [x] Fresh full checks: tools/check-core.ps1 -Renderer -ReleaseWasm -Workspace -NativeCamera -Samples validation/.cache -JunoAssets -SolarAssets, plus new actual resource audit. Restart final server and test real visible GPU level transitions, FOV matching, blacks, environment/PBR/rings, tile eviction/disable/exit. Do not claim VR or scientific 3D galaxy reconstruction.
- [x] Commit/push verified milestone, gh nonblocking CI check. No agent individual commits/versions; parent owns combined commit after all checks.

Evidence: docs/evidence/deep-space-lod-0.0.36/README.md. GPU coverage and limits recorded explicitly.
