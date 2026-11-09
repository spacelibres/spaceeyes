---
name: bevy-rendering
description: Use when choosing Bevy 0.19's built-in renderer versus an API-only, headless, or external renderer; selecting forward or deferred PBR; migrating `RenderGraph` nodes to render systems; configuring 2D/3D render Cargo features; or deciding how physics crates such as `bevy_rapier3d` relate to rendering.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: render
  bevy_version: "0.19"
---

# Bevy 0.19 — rendering choices

Start with Bevy's built-in wgpu renderer unless a measured constraint requires a
custom path. Renderer replacement changes asset preparation, visibility, cameras,
materials, platform integration, and debugging—not just one plugin.

## First classify the need

| Need | Path |
|---|---|
| Ordinary 2D/3D game, editor, or visualization | Built-in `2d` / `3d` profile |
| Custom shaders or a special pass | Extend built-in rendering |
| Many dynamic lights on desktop-class GPUs | Consider deferred opaque rendering |
| Server simulation with no pixels | Headless `MinimalPlugins` profile |
| Existing proprietary/embedded renderer | `2d_api` / `3d_api` plus an explicit bridge |
| Physics, collision, character motion | [`bevy-physics`](../bevy-physics/SKILL.md); this does not select a renderer |

Do not replace the renderer because a physics crate is present.
`bevy_rapier3d` computes rigid-body simulation and queries. Its optional debug drawing
uses Bevy rendering, but Rapier is not a renderer.

## Built-in renderer

```toml
[dependencies]
bevy = { version = "0.19", default-features = false, features = ["3d", "ui"] }
```

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, setup)
        .run();
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.spawn((
        Mesh3d(meshes.add(Cuboid::new(1.0, 1.0, 1.0))),
        MeshMaterial3d(materials.add(Color::srgb(0.3, 0.7, 0.9))),
    ));
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 2.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn(DirectionalLight::default());
}
```

`3d` is a complete profile. `3d_bevy_render` is the lower-level collection that
selects Bevy's renderer; `3d_api` supplies world-side 3D types without a renderer.
Profiles only trim dependencies when `default-features = false`.

## Forward versus deferred

Forward is the default opaque method. Prefer it for broad platform coverage,
MSAA, lower bandwidth, fewer lights, and material flexibility. Deferred moves opaque
material data into a G-buffer and can reduce repeated geometry work with many lights,
but uses more bandwidth and does not support MSAA.

```rust
use bevy::{
    core_pipeline::prepass::{DeferredPrepass, DepthPrepass},
    pbr::DefaultOpaqueRendererMethod,
    prelude::*,
};

fn enable_deferred(app: &mut App) {
    app.insert_resource(DefaultOpaqueRendererMethod::deferred());
}

fn spawn_deferred_camera(mut commands: Commands) {
    commands.spawn((
        Camera3d::default(),
        Msaa::Off,
        DepthPrepass,
        DeferredPrepass,
    ));
}
```

This choice applies to opaque rendering. Transparent materials still need their
appropriate forward/transparent path. Benchmark representative content on minimum
spec hardware rather than selecting from light count alone.

## Extend before replacing

Use these escalation levels:

1. `StandardMaterial` properties and camera/post-process components.
2. `Material`, `Material2d`, or `MaterialExtension` for shader specialization.
3. A render-world extraction/prepare/queue pipeline.
4. A Bevy 0.19 render system in `Core2d` / `Core3d` for a custom pass.
5. A fully external renderer only when the earlier levels cannot meet the constraint.

Camera `ViewNode`/render-graph-node APIs were removed in 0.19. Render passes are
systems using `ViewQuery` and `RenderContext`, ordered against actual system functions
or `Core3dSystems`/`Core2dSystems` sets. The top-level schedule named
`bevy::render::renderer::RenderGraph` remains for non-camera work.

## Headless or external rendering

```toml
# Simulation/server: no render stack.
bevy = { version = "0.19", default-features = false, features = [
  "default_app", "multi_threaded", "serialize"
] }

# External renderer that consumes Bevy's world-side 3D types.
# bevy = { version = "0.19", default-features = false, features = [
#   "default_app", "3d_api"
# ] }
```

An external bridge must define ownership and synchronization for transforms, meshes,
materials, cameras, visibility, asset lifetime, GPU uploads, window/surface events,
and frame pacing. Keep renderer-specific handles in dedicated components; do not leak
them into gameplay components.

## Rapier integration boundary

For Bevy 0.19, `bevy_rapier3d 0.36` is the matching release line. Rapier defaults to
`PostUpdate` with a variable timestep; tick-coupled games may explicitly move it to
`FixedUpdate`. Drive a visible entity and collider from one authoritative transform
policy, and keep display-only smoothing separate. See
[`bevy-physics`](../bevy-physics/SKILL.md) and
[the physics boundary](references/physics-boundary.md).

## Audit and references

Run `python3 scripts/audit_renderer_features.py path/to/Cargo.toml` to catch common
profile and Rapier/debug-render mismatches.

- [Renderer decision guide](references/renderer-choice.md)
- [Bevy 0.19 render systems](references/render-systems.md)
- [Physics versus rendering](references/physics-boundary.md)
- [`bevy-cargo-features`](../bevy-cargo-features/SKILL.md)
- [`bevy-pbr-materials`](../bevy-pbr-materials/SKILL.md)
- [`bevy-physics`](../bevy-physics/SKILL.md)
- [`bevy-diagnostics-profiling`](../bevy-diagnostics-profiling/SKILL.md)
- [`bevy-vfx`](../bevy-vfx/SKILL.md)
- [`bevy-wasm-webgpu`](../bevy-wasm-webgpu/SKILL.md)
