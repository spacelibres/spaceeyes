# bevy-vfx — Non-hanabi VFX: CPU particles, flipbooks, vector shapes, trails, decals

> Referenced from `bevy-vfx/SKILL.md § Topics`.

## When NOT to use hanabi

`bevy_hanabi` is the right tool for GPU-computed fields of thousands of independent
particles. Reach for the alternatives below when:

- **Count < ~100 particles** — spawning individual `Sprite` entities and driving them
  with a Bevy system is simpler, debuggable, and zero dependency overhead.
- **WebGL2 target** — `bevy_hanabi 0.19.0` requires WebGPU. It will not compile or
  run on `wasm32` with the `webgl2` feature. Use sprite flipbooks or custom-material
  shaders instead.
- **Canned, identical-every-time FX** — hit-sparks, muzzle flashes, explosions where
  every instance plays the same frame sequence. A sprite-sheet flipbook is simpler and
  runs on any backend.
- **Stylized / geometric look** — rings, lightning bolts, SDF shapes. Use
  `bevy_vector_shapes` rather than fighting hanabi's shading model.

## CPU-particle pattern

For small bursts (smoke puffs, blood splatter, debris), spawn entities directly.
Main-world simulation, extraction, and render preparation scale with entity count.
Compatible sprites can batch, while texture/material changes split batches.

```rust
use bevy::prelude::*;

#[derive(Component)]
struct Particle {
    velocity: Vec3,
    lifetime: Timer,
}

fn spawn_burst(mut commands: Commands, asset_server: Res<AssetServer>) {
    let image = asset_server.load("textures/spark.png");
    for i in 0..30_u32 {
        let angle = (i as f32 / 30.0) * std::f32::consts::TAU;
        commands.spawn((
            Sprite::from_image(image.clone()),
            Transform::from_xyz(0.0, 0.0, 0.0),
            Particle {
                velocity: Vec3::new(angle.cos(), angle.sin(), 0.0) * 3.0,
                lifetime: Timer::from_seconds(0.8, TimerMode::Once),
            },
        ));
    }
}

fn tick_particles(
    mut commands: Commands,
    time: Res<Time>,
    mut q: Query<(Entity, &mut Transform, &mut Particle)>,
) {
    for (entity, mut xf, mut p) in &mut q {
        p.lifetime.tick(time.delta());
        if p.lifetime.is_finished() {
            commands.entity(entity).despawn();
        } else {
            xf.translation += p.velocity * time.delta_secs();
            p.velocity *= 0.92; // drag
        }
    }
}
```

Benchmark the target scene and hardware. As entity count or batch fragmentation grows,
switch to Hanabi or collapse the effect into a single `Mesh2d` with a custom material.

## Sprite-sheet flipbooks — `bevy_spritesheet_animation 7.0.1`

`bevy_spritesheet_animation` (depends on `bevy = "0.19"`) drives `TextureAtlas`
index sequences stored as Bevy animation assets. Best fit: repeatable frame sequences
such as explosions, hit-sparks, and muzzle flashes.

```toml
[dependencies]
bevy = "0.19"
bevy_spritesheet_animation = "7.0.1"
```

Key types: `SpritesheetAnimationPlugin`, `Spritesheet`, `Animation`,
`AnimationDuration`, and `SpritesheetAnimation`. Build each sequence once from a
`Spritesheet`, register it in `Assets<Animation>`, and give each animated entity a
`SpritesheetAnimation` holding the asset handle:

```rust
use bevy::prelude::*;
use bevy_spritesheet_animation::prelude::*;

fn setup_flipbook(
    mut commands: Commands,
    assets: Res<AssetServer>,
    mut animations: ResMut<Assets<Animation>>,
    mut atlas_layouts: ResMut<Assets<TextureAtlasLayout>>,
) {
    let image = assets.load("textures/explosion.png");
    let spritesheet = Spritesheet::new(&image, 8, 8);
    let animation = spritesheet
        .create_animation()
        .add_row(0)
        .set_duration(AnimationDuration::PerFrame(50))
        .build();
    let animation = animations.add(animation);

    commands.spawn((
        spritesheet
            .with_size_hint(1024, 1024)
            .sprite(&mut atlas_layouts),
        SpritesheetAnimation::new(animation),
    ));
}
```

Add `SpritesheetAnimationPlugin` to the app. Store handles in a custom resource when
several systems need to spawn the same effect; do not rebuild identical assets per
instance.

What it does NOT do: individual particle physics. The asset describes a frame
sequence; add separate components and systems for per-instance velocity or simulation.

## Vector / SDF shapes — `bevy_vector_shapes 0.13.1`

`bevy_vector_shapes` (targets Bevy 0.19) renders GPU-accelerated circles, lines,
arcs, and polygons with SDF anti-aliasing.

```toml
[dependencies]
bevy = "0.19"
bevy_vector_shapes = "0.13.1"
```

Key types: `Shape2dPlugin`, `ShapePainter`. Call `painter.circle(radius)`,
`painter.line(start, end)`, `painter.ngon(sides, radius)` in a system; the plugin
batches them into draw calls automatically.

Good for: stylized SFX — shockwave rings, lightning bolts, lock-on reticles, force
fields. The look is crisp and geometric rather than textured.

> **`bevy_prototype_lyon` is abandoned for Bevy 0.19.** The latest published release
> has not published a Bevy 0.19-compatible release. Do not add it without first
> checking its current dependency metadata. `bevy_vector_shapes` is the maintained
> choice used by this skill.

## Trails

Do not assume a third-party trail crate is Bevy 0.19-compatible. Two durable
engine-level approaches are:

- **`LineList` mesh history** — maintain a ring buffer of the trailing entity's recent
  world positions; rebuild a `LineList` or `TriangleStrip` `Mesh` each frame (or every
  N frames). Full control over width, UV scrolling, fading.
- **`ShapePainter` line strokes** — call `painter.line(prev, cur)` each frame from the
  history buffer. Simpler code; less control over width taper and UVs.

Both approaches are hand-rolled; choose based on how much visual polish the trail needs.

## Decals

No dedicated decal crate targets Bevy 0.19. The hand-roll approach:

1. Spawn a thin quad slightly offset from receiver geometry (or use a `DepthBiasState`).
2. Assign a custom `Material` with `AlphaMode::Blend` (or `Premultiplied`) and a
   decal texture.
3. For projected decals (arbitrary receiver geometry), add a projection matrix uniform
   to the material and clip in the fragment shader.

This is a known gap in the ecosystem. Complexity scales quickly for projected decals —
budget authoring time accordingly.

## See also

- [`../SKILL.md`](../SKILL.md) — top-level bevy-vfx dispatcher
- [`shader-effects.md`](shader-effects.md) — single-quad procedural FX as an
  alternative to particle systems
- [`performance.md`](performance.md) — draw-call cost model for each technique
- `bevy-pbr-materials` — `AsBindGroup`, `AlphaMode`, and custom material registration
- `bevy-wasm-webgpu` — which techniques survive WebGL2 vs WebGPU builds
