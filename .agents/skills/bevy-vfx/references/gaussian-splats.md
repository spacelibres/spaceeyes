# Gaussian splats with `bevy_gaussian_splatting`

Gaussian splatting renders a captured scene as many soft, oriented primitives with
position, covariance, colour, and opacity. It is useful for photoreal backdrops and
scanned objects, not as a drop-in replacement for interactive mesh geometry.

## Bevy 0.19 pairing

`bevy_gaussian_splatting 8.0.1` declares Bevy 0.19 support. Its default features
include `nightly_generic_alias`, so stable-Rust applications must disable defaults
and choose a preset or explicit feature set.

```toml
[dependencies]
bevy = "0.19"

# Upstream's `headless` preset is a stable-compatible native integration preset.
bevy_gaussian_splatting = { version = "8.0.1", default-features = false, features = ["headless"] }
```

For an upstream viewer build on nightly, defaults can be enabled. Keep a stable
application on an explicit set so an upstream default-feature change cannot silently
introduce a nightly requirement.

## Load and spawn a cloud

```rust
use bevy::prelude::*;
use bevy_gaussian_splatting::{
    CloudSettings, GaussianSplattingPlugin, PlanarGaussian3dHandle,
};

fn main() {
    App::new()
        .add_plugins((DefaultPlugins, GaussianSplattingPlugin))
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn((
        PlanarGaussian3dHandle(asset_server.load("scenes/capture.gcloud")),
        CloudSettings::default(),
        Transform::default(),
    ));

    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 1.5, 5.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

The crate provides `.gcloud` and `.ply` loaders and glTF
`KHR_gaussian_splatting` scene support. Version 8.0.1 does **not** provide SPZ I/O.
Convert SPZ captures outside the game or retain the original renderer in a separate
tooling process.

## Backend and target choices

- Native builds normally use storage buffers and one of the provided sorting
  implementations.
- The crate advertises both WebGPU and WebGL2 support. Its manifest marks the
  `webgl2`/buffer-texture route as deprecated, so treat WebGPU as the preferred web
  target and test WebGL2 as a compatibility path.
- Upstream's `web` feature enables WebGPU plus web asset loading. Do not add it to a
  native-only build merely to load local files.
- Captures can be large. Track both CPU asset memory and uploaded GPU memory, then
  measure on minimum-spec hardware.

## Combine splats with gameplay

Use splats for captured, mostly static appearance and ordinary Bevy entities for
gameplay:

- Meshes provide collision geometry, ray casting, nav meshes, destructibility, and
  dynamic PBR lighting.
- A splat cloud's colour and illumination are baked. `DirectionalLight` and
  `PointLight` do not relight it like a `StandardMaterial` mesh.
- Transparent splats can amplify overdraw alongside particles and transparent
  materials. Profile the combined scene rather than each effect alone.
- Align scale, origin, handedness, and camera exposure during import. Keep a small
  known-scale mesh in the scene while calibrating.

## Capture pipeline

1. Capture multi-view images or video.
2. Train a 2DGS/3DGS/4DGS representation in external tooling.
3. Export or convert to `.ply`, `.gcloud`, or a supported glTF scene.
4. Validate orientation, scale, memory, and artifacting in a representative camera
   path.
5. Build simplified mesh proxies for physics, navigation, occlusion, and interaction.

The Bevy crate is a renderer and converter, not a complete capture/training system.

## Incompatible alternative

`bevy_spark 0.2.0` depends on Bevy 0.18. Cargo may resolve two Bevy versions, but
their ECS, asset, and render types are distinct and cannot be passed between the
crates. Do not recommend it for a Bevy 0.19 application.

## See also

- [`../SKILL.md`](../SKILL.md)
- [Performance](performance.md)
- [`../../bevy-rendering/SKILL.md`](../../bevy-rendering/SKILL.md)
- [`../../bevy-cameras/SKILL.md`](../../bevy-cameras/SKILL.md)
- [`../../bevy-wasm-webgpu/SKILL.md`](../../bevy-wasm-webgpu/SKILL.md)
