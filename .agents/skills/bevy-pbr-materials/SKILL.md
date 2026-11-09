---
name: bevy-pbr-materials
description: Use when spawning `Mesh3d` with `StandardMaterial`, writing a Bevy 0.19 custom `Material` with `AsBindGroup`, enabling `shadow_maps_enabled` or contact shadows, configuring atmosphere entities, loading glTF `/std` material sub-assets, or selecting forward versus deferred PBR.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: render
  bevy_version: "0.19"
---

# Bevy 0.19 — PBR Materials

## When to use this skill

- Texturing a mesh with the built-in physically based shader.
- Writing a custom `Material` (e.g. for stylised shading, dissolve effects, world-space shaders).
- Enabling shadow maps or Bevy 0.19 contact shadows.
- Spawning an `Atmosphere` entity and enabling it on a camera.
- Compiler error on `AsBindGroup::label()` (now required).
- Compiler error on `MaterialPlugin::<M> { prepass_enabled: ... }` (fields removed in 0.18).

## Canonical pattern — StandardMaterial

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
    let mesh = meshes.add(Cuboid::new(1.0, 1.0, 1.0));
    let material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.8, 0.3, 0.2),
        perceptual_roughness: 0.4,
        metallic: 0.1,
        ..default()
    });

    commands.spawn((
        Mesh3d(mesh),
        MeshMaterial3d(material),
        Transform::from_xyz(0.0, 0.5, 0.0),
    ));

    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 2.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));

    commands.spawn((
        DirectionalLight::default(),
        Transform::from_xyz(2.0, 4.0, 2.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}
```

## Custom material — Bevy 0.19 shape

Custom materials with the `Material` trait and `AsBindGroup` are covered in
detail at [references/custom-material.md](references/custom-material.md).

## Topics

| Topic | Reference |
|-------|-----------|
| `PointLight`, `DirectionalLight`, `SpotLight`; `GlobalAmbientLight`; shadow maps, contact shadows, atmosphere | [references/lighting.md](references/lighting.md) |
| `Plane3d`, `Cuboid`, `Sphere`, `Circle`, `Cylinder`, `Capsule3d`, `Torus` constructors and orientation gotchas | [references/mesh-primitives.md](references/mesh-primitives.md) |
| `Material` trait methods, `AsBindGroup` attributes, `ShaderRef` variants, `MaterialPlugin` wiring | [references/custom-material.md](references/custom-material.md) |

## Bevy 0.19 gotchas

- **`MaterialPlugin::<M> { prepass_enabled, shadows_enabled, ..default() }` is gone.** Override the `Material` trait methods instead — see [references/custom-material.md](references/custom-material.md).
- **Light fields use `shadow_maps_enabled`.** `shadows_enabled` was renamed because
  Bevy 0.19 adds the separate `contact_shadows_enabled` control.
- **Contact shadows require both sides.** Add `ContactShadows` to the camera and set
  `contact_shadows_enabled: true` on participating lights.
- **`Atmosphere` is its own entity.** Keep `AtmosphereSettings` on the camera and
  spawn `bevy::light::Atmosphere` separately.
- **glTF material labels changed.** `#Material0` loads `GltfMaterial`; use
  `#Material0/std` when you specifically need `Handle<StandardMaterial>`.
- **`AsBindGroup::label()` is required.** The `#[derive(AsBindGroup)]` macro generates it automatically; hand-rolled impls must add it.
- **Mesh component wrappers.** Use `Mesh3d(handle)` and `MeshMaterial3d(material_handle)` — the wrappers are what the renderer queries on.
- **`Plane3d::new` takes `Vec2` for `half_size`**, not a scalar — see [references/mesh-primitives.md](references/mesh-primitives.md).
- **`Color::rgb(...)` is gone** — use `Color::srgb(...)` or `Color::linear_rgb(...)`.
- **Directional light position is ignored** — only rotation matters. See [references/lighting.md](references/lighting.md).

## See also

- [`bevy-rendering`](../bevy-rendering/SKILL.md) — built-in renderer, forward/deferred,
  custom passes, and renderer replacement boundaries.
- [`bevy-cameras`](../bevy-cameras/SKILL.md) — views, HDR, and render targets.
- [`bevy-migration-0-18-to-0-19`](../bevy-migration-0-18-to-0-19/SKILL.md) — light,
  atmosphere, glTF material, and render-system migrations.
