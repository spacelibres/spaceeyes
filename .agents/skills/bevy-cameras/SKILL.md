---
name: bevy-cameras
description: Use when spawning Bevy 0.19 `Camera3d` or `Camera2d`, choosing a `Projection`, rendering to an image with a `RenderTarget` component, wiring `FreeCamera`/`PanCamera`, building an obstruction-aware third-person orbit camera, ordering views, or setting per-camera `AmbientLight`.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: render
  bevy_version: "0.19"
---

# Bevy 0.19 — Cameras

## When to use this skill

- Spawning the main game camera.
- Rendering to a texture (mini-map, portal, post-process target).
- Wanting a drop-in free-look or pan controller without writing your own.
- Configuring multiple cameras with different `order` for overlays.
- Setting ambient brightness on a per-camera basis.
- Building a third-person pivot/boom camera with fixed-pose interpolation and Rapier
  obstruction casts.

## Canonical pattern

`FreeCamera`/`PanCamera` are gated behind Cargo features. In `Cargo.toml`:

```toml
bevy = { version = "0.19", features = ["free_camera", "pan_camera"] }
```

```rust
use bevy::asset::RenderAssetUsages;
use bevy::camera::RenderTarget;
use bevy::camera_controller::free_camera::{FreeCamera, FreeCameraPlugin};
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(FreeCameraPlugin) // adds the input wiring
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    // 1. Main camera with the built-in free-look controller.
    commands.spawn((
        Camera3d::default(),
        FreeCamera::default(),
        Transform::from_xyz(0.0, 4.0, 8.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));

    // 2. A texture target for an off-screen render pass (mini-map, portal).
    let size = bevy::render::render_resource::Extent3d {
        width: 512,
        height: 512,
        depth_or_array_layers: 1,
    };
    let mut image = Image::new_fill(
        size,
        bevy::render::render_resource::TextureDimension::D2,
        &[0; 4],
        bevy::render::render_resource::TextureFormat::Bgra8UnormSrgb,
        RenderAssetUsages::default(),
    );
    image.texture_descriptor.usage =
        bevy::render::render_resource::TextureUsages::TEXTURE_BINDING
            | bevy::render::render_resource::TextureUsages::COPY_DST
            | bevy::render::render_resource::TextureUsages::RENDER_ATTACHMENT;
    let image_handle = images.add(image);

    // 3. A second camera that draws into the texture.
    //    RenderTarget is now a *separate* component, not Camera.target.
    commands.spawn((
        Camera3d::default(),
        Camera { order: -1, ..default() }, // -1 = render before the main camera
        RenderTarget::Image(image_handle.into()),
        Transform::from_xyz(10.0, 5.0, 0.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

## Choosing a projection

```rust
use bevy::prelude::*;
use bevy::camera::Projection;

# fn _proj(mut commands: Commands) {
// Default perspective (45° vertical FOV).
commands.spawn((Camera3d::default(), Projection::default()));

// Orthographic for top-down or strategy views.
commands.spawn((
    Camera3d::default(),
    Projection::Orthographic(OrthographicProjection {
        scale: 10.0,
        ..OrthographicProjection::default_3d()
    }),
));
# }
```

## Ambient light: world default vs per-camera

```rust
use bevy::prelude::*;
use bevy::light::GlobalAmbientLight;

# fn _amb(app: &mut App, mut commands: Commands) {
// World default — applies everywhere unless a camera overrides.
app.insert_resource(GlobalAmbientLight {
    brightness: 200.0,
    ..default()
});

// Per-camera override (`AmbientLight` is a Component).
commands.spawn((Camera3d::default(), AmbientLight { brightness: 1000.0, ..default() }));
# }
```

## Bevy 0.19 gotchas

- **`RenderTarget` is a separate component.** `Camera { target: ... }` is an old
  shape. Spawn `RenderTarget` alongside `Camera3d` / `Camera`.
- **`AmbientLight` is no longer a `Resource`.** It's a per-camera component. The world default lives in the `GlobalAmbientLight` resource.
- **`ImageRenderTarget::scale_factor` is `f32`** (used to be wrapped in `FloatOrd`).
- **Camera `order` is signed.** Lower values render first. Use `order: -1` for off-screen passes you'll sample in the main pass.
- **`FreeCamera` / `PanCamera` need their plugin and Cargo feature.** Add
  `features = ["free_camera", "pan_camera"]`; spawning only the component does not
  install its input systems.
- **Imports**: `bevy::camera::RenderTarget`, `bevy::camera_controller::{free_camera::*, pan_camera::*}`, `bevy::light::GlobalAmbientLight`. None are in the prelude.

## See also

- [Third-person orbit camera](references/third-person-orbit.md) — pivot/boom separation,
  pitch limits, smoothing, fixed interpolation, sphere casts, hysteresis, and actor fade.
- [`bevy-rendering`](../bevy-rendering/SKILL.md) — renderer choice, forward/deferred,
  and render systems.
- [`bevy-input-actions`](../bevy-input-actions/SKILL.md) — rebindable camera/aim input
  and correct mouse-delta transfer.
- [`bevy-physics`](../bevy-physics/SKILL.md) — Rapier scene-query setup and filtering.
- [`bevy-pbr-materials`](../bevy-pbr-materials/SKILL.md) — lighting and camera-visible
  materials.
- [`bevy-a11y`](../bevy-a11y/SKILL.md) — FOV, shake, motion, and viewport accessibility.
