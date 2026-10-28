---
name: bevy-vfx
description: Use when adding GPU particles with `bevy_hanabi 0.19`, rendering Gaussian splats with `bevy_gaussian_splatting 8`, choosing sprite-sheet or vector-shape effects, writing custom WGSL materials, or profiling VFX on native and web targets in Bevy 0.19.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "4"
  area: render
  bevy_version: "0.19"
---

# Bevy 0.19 — VFX

Use this skill for particles, procedural shader effects, flipbooks, vector shapes,
and Gaussian-splat scene rendering.

## Supported crate pairings

```toml
[dependencies]
bevy = "0.19"
bevy_hanabi = "0.19"
bevy_spritesheet_animation = "7.0.1"
bevy_vector_shapes = "0.13.1"

# The default feature set enables a nightly-only alias. This stable-Rust preset
# retains native file loading, PLY/gcloud formats, and CPU/GPU sort options.
bevy_gaussian_splatting = { version = "8.0.1", default-features = false, features = ["headless"] }
```

`bevy_spark 0.2` targets Bevy 0.18. Do not add it to a Bevy 0.19 dependency
graph. Use `bevy_gaussian_splatting 8` or isolate an older renderer in a separate
process.

## Choose the smallest suitable technique

| Need | Technique |
|---|---|
| Thousands of independently simulated particles | `bevy_hanabi` |
| A repeatable hit spark, muzzle flash, or explosion | Sprite-sheet flipbook |
| Fewer than roughly 100 simple particles | Bevy `Sprite` entities and a system |
| A full-surface fire, water, dissolve, or distortion effect | Custom `Material` + WGSL |
| Crisp rings, arcs, lightning, or targeting shapes | `bevy_vector_shapes` |
| A photogrammetry-derived, baked-light scene | `bevy_gaussian_splatting` |

## Canonical Hanabi effect

This pattern uses the Bevy 0.19-compatible `bevy_hanabi 0.19` API:

```rust
use bevy::prelude::*;
use bevy_hanabi::prelude::{
    AccelModifier, Attribute, ColorOverLifetimeModifier, EffectAsset, ExprWriter,
    HanabiPlugin, ParticleEffect, SetAttributeModifier, SetPositionSphereModifier,
    SetVelocitySphereModifier, ShapeDimension, SpawnerSettings,
};

fn main() {
    App::new()
        .add_plugins((DefaultPlugins, HanabiPlugin))
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands, mut effects: ResMut<Assets<EffectAsset>>) {
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 3.0, 20.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));

    let writer = ExprWriter::new();
    let position = SetPositionSphereModifier {
        center: writer.lit(Vec3::ZERO).expr(),
        radius: writer.lit(1.0_f32).expr(),
        dimension: ShapeDimension::Volume,
    };
    let velocity = SetVelocitySphereModifier {
        center: writer.lit(Vec3::ZERO).expr(),
        speed: writer.lit(4.0_f32).expr(),
    };
    let lifetime = SetAttributeModifier::new(
        Attribute::LIFETIME,
        writer.lit(0.5_f32).uniform(writer.lit(1.5_f32)).expr(),
    );
    let age = SetAttributeModifier::new(Attribute::AGE, writer.lit(0.0_f32).expr());
    let gravity = AccelModifier::new(writer.lit(Vec3::new(0.0, -6.0, 0.0)).expr());

    let mut colors: bevy_hanabi::Gradient<Vec4> = bevy_hanabi::Gradient::new();
    colors.add_key(0.0, Vec4::new(4.0, 0.5, 0.0, 1.0));
    colors.add_key(0.5, Vec4::new(2.0, 1.0, 0.0, 0.8));
    colors.add_key(1.0, Vec4::new(0.5, 0.5, 0.5, 0.0));

    let effect = EffectAsset::new(
        16_384,
        SpawnerSettings::rate(200.0_f32.into()),
        writer.finish(),
    )
    .with_name("ember_burst")
    .init(position)
    .init(velocity)
    .init(lifetime)
    .init(age)
    .update(gravity)
    .render(ColorOverLifetimeModifier::new(colors));

    commands.spawn((
        Name::new("ember_burst"),
        ParticleEffect::new(effects.add(effect)),
        Transform::default(),
        Visibility::default(),
    ));
}
```

## Critical rules

- Initialize both `Attribute::LIFETIME` and `Attribute::AGE` before using
  `ColorOverLifetimeModifier`.
- `ExprWriter::lit` returns a writer expression; use `.expr()` where a modifier
  expects an expression handle.
- Import Hanabi types explicitly because both Bevy UI and Hanabi export a type named
  `Gradient`.
- Spawn `ParticleEffect` as a component. Its required components supply the internal
  render-world state; there is no `ParticleEffectBundle`.
- Hanabi simulation uses compute shaders. Web builds therefore need WebGPU. Sprite
  flipbooks, CPU particles, and compatible custom materials remain WebGL2 options.
- `bevy_gaussian_splatting 8` supports WebGL2 and WebGPU, but its `webgl2` path is
  deprecated upstream. Test the exact browser/GPU matrix before choosing it.
- Gaussian splats have baked appearance: they do not automatically gain Bevy PBR
  lighting, shadows, collision, or navigation.

## References

- [Hanabi anatomy](references/hanabi-anatomy.md)
- [Hanabi modifiers](references/hanabi-modifiers.md)
- [2D versus 3D particles](references/hanabi-2d-vs-3d.md)
- [Non-Hanabi effects](references/non-hanabi-vfx.md)
- [Custom shader effects](references/shader-effects.md)
- [Gaussian splats](references/gaussian-splats.md)
- [Performance and web constraints](references/performance.md)

## See also

- [`bevy-pbr-materials`](../bevy-pbr-materials/SKILL.md) — custom materials and WGSL.
- [`bevy-rendering`](../bevy-rendering/SKILL.md) — renderer architecture and backend
  selection.
- [`bevy-cameras`](../bevy-cameras/SKILL.md) — framing and render targets.
- [`bevy-wasm-webgpu`](../bevy-wasm-webgpu/SKILL.md) — browser backend setup.
- [`bevy-animation`](../bevy-animation/SKILL.md) — procedural easing without particles.
