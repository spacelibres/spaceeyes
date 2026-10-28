---
name: bevy
description: Use when starting any Bevy task, choosing between Update and FixedUpdate, picking Cargo feature flags, or recalling which sibling skill covers ECS, assets, rendering, or migration. Routes to the right Bevy 0.19 skill and pins the engine version for downstream snippets.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: router
  bevy_version: "0.19"
---

# Bevy 0.19 — Router

**Read this first when working on a Bevy project.** All current implementation
sibling skills assume Bevy 0.19 (released 2026-06-19); historical migration
skills deliberately describe their source versions. If the user's `Cargo.toml`
pins a different version, stop and confirm before applying current patterns from
this collection.

## Smallest valid app

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands) {
    commands.spawn(Camera3d::default());
}
```

## When to use which skill

| Task | Skill |
|---|---|
| App / Plugin / Schedule basics, Update vs FixedUpdate, exclusive systems | `bevy-core-concepts` |
| Rebindable actions, gamepad hot-plug, deadzones, mouse capture, frame-to-fixed input | `bevy-input-actions` |
| Deterministic App/time stepping, messages/observers, async and visual tests | `bevy-testing` |
| `#[derive(Component)]`, `#[require(...)]`, observers (`On<E>`), hooks, storage | `bevy-ecs-components` |
| `Query`, filters, `par_iter`, query lenses, `IterQueryData`, `SingleEntityQueryData` | `bevy-ecs-queries` |
| `SystemParam`, `SystemSet`, `.run_if`, ordering, `remove_systems_in_set` | `bevy-ecs-systems` |
| `Cargo.toml` features: `2d`/`3d`/`ui`, mid-level `2d_api`, renamed features | `bevy-cargo-features` |
| Upgrading from 0.17 — `MessageReader`, `On`, `RenderTarget`, `GlobalAmbientLight`, etc. | `bevy-migration-0-17-to-0-18` |
| Upgrading from 0.18 — resources-as-components, `FontSource`, `WorldAssetRoot`, `Discard` | `bevy-migration-0-18-to-0-19` |
| `AssetServer`, handles, hot-reload, glTF `WorldAssetRoot`/`WorldInstanceReady` | `bevy-assets` |
| Writing an `AssetLoader`, `LoadContext::load_builder`, `SeekableReader` | `bevy-custom-assets` |
| Versioned save DTOs, stable IDs, migrations, atomic native/browser persistence | `bevy-save-load` |
| WASM build pipeline, WebGPU vs WebGL2 | `bevy-wasm-webgpu` |
| `Camera3d`, projections/targets, free/pan controls, third-person orbit/obstruction | `bevy-cameras` |
| Built-in renderer vs custom/headless/external paths, forward vs deferred | `bevy-rendering` |
| Custom diagnostics, tracing spans, render CPU/GPU timings, platform budgets | `bevy-diagnostics-profiling` |
| `RapierPhysicsPlugin`, `RigidBody`, `Collider`, collision queries, character controllers | `bevy-physics` |
| `StandardMaterial`, `MaterialPlugin<M>`, `AsBindGroup::label()`, PBR tuning | `bevy-pbr-materials` |
| glTF clips, `AnimationGraph`, transitions, masks, events, procedural animation | `bevy-animation` |
| Hanabi particles, shaders, Gaussian splats, compatible VFX crates | `bevy-vfx` |
| `AudioPlayer`, sinks, spatial listeners, mix/transition policy, Seedling boundary | `bevy-audio` |
| Voxel meshing with `block-mesh-rs`, chunk pipeline, greedy quads | `bevy-voxel-pipeline` |
| RON block definitions, palette, KTX2 atlas baking | `bevy-voxel-data` |
| Dirty sections, revision tokens, coalesced remesh queues, bounded mesh/collider swaps | `bevy-voxel-runtime` |
| Camera recording, MP4/PNG encoders, ffmpeg integration | `bevy-capture` |
| `es-fluent-manager-bevy` i18n — `FluentText<T>`, `BevyFluentText`, `LocaleChangeEvent`, `i18n.toml` | `bevy-fluent` |
| `Node`, `Button`, `Interaction`, `children![]`, `TextFont`, `InputFocus`, `BorderRadius`, `BackgroundColor` | `bevy-ui` |
| Screen readers, focus navigation, captions, contrast, remapping, adaptive controllers | `bevy-a11y` |
| Porting from Unity, Unreal, Godot, Cocos, web engines, Flash, Defold, Roblox, or GameMaker | `bevy-porting` |
| Detecting copy-paste / near-duplicate Rust code before committing (`similarity-rs --cross-file`) | `similarity-rs` |

## Cardinal rules (every Bevy 0.19 task)

1. **Events are messages.** `EventReader<E>` and `EventWriter<E>` were renamed to `MessageReader<M>` / `MessageWriter<M>` in 0.17. They are still wrong in 0.19.
2. **Observers use `On<E>`, not `Trigger<E>`.** `Trigger` was renamed in 0.17 (PR #19596).
3. **Declare order when behavior depends on it.** Shared mutable access prevents
   parallel execution but does not choose a logical order. Use `.before()`, `.after()`,
   or `.chain()`, especially when deferred commands must be visible downstream.
4. **No `.unwrap()` in systems.** Systems run every frame. Use `let ... else { return };` or a real error path.
5. **Resources are singleton components in 0.19.** Each resource lives on a
   resource entity. Inserting the same `Resource` type on an ordinary entity can
   move singleton ownership, so do not mix resource and ordinary-component use;
   audit broad `Query<&T>` access.
6. **Text uses `FontSource` and `FontSize`.** Convert handles with `.into()` and sizes with `FontSize::Px(...)`.
7. **Classic scene serialization moved.** Use `bevy_world_serialization`, `WorldAssetRoot`, and `DynamicWorld`; `bevy_scene` now hosts BSN.
8. **Lifecycle replacement is discard.** Use `Discard`, `on_discard`, and `#[component(on_discard = ...)]`.
9. **Camera render nodes became systems.** Extend `Core2d`/`Core3d` with render
   systems. The top-level non-camera schedule named `RenderGraph` still exists.
10. **Physics is a plugin choice.** Bevy core has no rigid-body engine. Use
    `bevy-physics` for the current Rapier/Avian boundary, schedules, and APIs.
11. **Frame input is not fixed-tick input.** Queue action edges and accumulate
    relative motion after `InputSystems`; drain once on the first available fixed tick
    while carrying held/absolute state to every tick.
12. **Runtime IDs are not save IDs.** Persist immutable domain identifiers in a
    versioned DTO and rebuild dense palettes/entities/handles while loading.

## Gotchas

- Bevy's training-data footprint is dominated by older code. Check both migration skills before trusting an apparently familiar snippet.
- `bevy::prelude::*` doesn't re-export everything. Many ECS internals live under `bevy::ecs::...` — import explicitly when needed.
- The `bevy` crate now re-exports many subcrates (`bevy_camera`, `bevy_light`, `bevy_post_process`, `bevy_anti_alias`, `bevy_input_focus`, `bevy_gizmos_render`, `bevy_sprite_render`, `bevy_ui_render`). Subcrate APIs are stable points to depend on for plugins.

## See also

- `bevy-migration-0-18-to-0-19` — current upgrade catalogue.
- `bevy-migration-0-17-to-0-18` — historical rename catalogue.
- `bevy-cargo-features` — what to put in `Cargo.toml` before any of the above will compile the way you want.
- `bevy-physics` — Rapier setup, fixed-step ordering, queries, and controllers.
- `bevy-input-actions` — logical input, devices, and the fixed-step bridge.
- `bevy-testing` — deterministic app stepping and visual regression.
- `bevy-diagnostics-profiling` — metrics, traces, render timing, and budgets.
