---
name: bevy-migration-0-18-to-0-19
description: Use when upgrading from Bevy 0.18 to Bevy 0.19, fixing resource/query conflicts, replacing `SceneRoot` with `WorldAssetRoot`, migrating text to `FontSource` and `FontSize`, converting render-graph nodes to render systems, replacing lifecycle `Replace` with `Discard`, or updating asset load builders, lights, input focus, and Cargo features.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: migration
  bevy_version: "0.19"
  target_version: "Bevy 0.19"
---

# Bevy 0.18 → 0.19 migration

Bevy 0.19.0 was released on 2026-06-19. Target `bevy = "0.19"` and validate
against the latest 0.19 patch release. Apply the official migration guide from top
to bottom; this skill prioritizes changes most likely to affect game code and sibling
skills.

## First-pass checklist

1. Update the engine and every Bevy ecosystem crate together. A crate built on Bevy
   0.18 cannot share ECS/assets/render types with Bevy 0.19.
2. Rebuild with the project's real `default-features` and target triples.
3. Fix resources and broad-query conflicts before chasing secondary system errors.
4. Update scenes, text, assets, rendering, lights, and UI focus.
5. Regenerate persisted animation target IDs and serialized world data.
6. Compile representative examples and exercise native and web/platform builds.

## High-impact changes

| Bevy 0.18 | Bevy 0.19 |
|---|---|
| `#[derive(Component, Resource)]` | Split into distinct types; `Resource: Component` |
| broad query plus `Res<T>` | Filter resource entities with `Without<IsResource>` when appropriate |
| `init_non_send_resource` | `init_non_send` |
| `SceneRoot` / `DynamicScene` | `WorldAssetRoot` / `DynamicWorld` |
| old world serialization in `bevy_scene` | `bevy_world_serialization` |
| `TextFont { font: Handle<_>, font_size: f32 }` | `FontSource` and `FontSize` |
| `TextLayout::new_with_justify` | `TextLayout::justify` |
| `LoadContext::loader()` | `LoadContext::load_builder()` |
| custom `Reader` with `AsyncSeekForward` | required `Reader::seekable()` |
| `ViewNode` and camera render-graph nodes | systems in `Core2d` / `Core3d` schedules |
| `Replace`, `on_replace` | `Discard`, `on_discard` |
| `set_executor_kind(ExecutorKind::...)` | `set_executor(...)` with an executor instance |
| light `shadows_enabled` | `shadow_maps_enabled` plus optional `contact_shadows_enabled` |
| `Atmosphere` on a camera | separate `bevy::light::Atmosphere` entity |
| public `InputFocus.0` | `get`, `set`, and `clear` methods |

The render-node API is gone, but the top-level non-camera schedule named
`bevy::render::renderer::RenderGraph` still exists. Do not replace that schedule name
blindly.

## Text and scenes

```rust
TextFont {
    font: asset_server.load("fonts/FiraSans-Bold.ttf").into(),
    font_size: FontSize::Px(24.0),
    ..default()
}

commands.spawn(WorldAssetRoot(
    asset_server.load("models/level.glb#Scene0"),
));
```

Parley/fontique now provide shaping and fallback. Installed-family discovery requires
the `system_font_discovery` feature. The old serialization system was renamed to make
room for BSN; glTF roots still use `WorldAssetRoot`, not BSN scene types.

See [text and fonts](references/text-and-fonts.md) and
[scene serialization](references/scene-serialization.md).

## Resources and generic queries

`Res<T>` and `ResMut<T>` remain the normal APIs. The semantic change is that resource
values live on singleton entities and `#[derive(Resource)]` also implements
`Component`. As a result, broad component queries can conflict with resource access or
unexpectedly include resource entities.

```rust
fn inspect_entities(
    entities: Query<EntityRef, Without<IsResource>>,
    settings: Res<GameSettings>,
) {
    // ...
}
```

Do not add `Without<IsResource>` mechanically to every query; narrow only queries that
are truly intended to inspect ordinary entities. See
[resources as components](references/resources-as-components.md).

## Features and ecosystem crates

```toml
[dependencies]
bevy = { version = "0.19", default-features = false, features = [
  "3d", "ui", "audio"
] }
```

- `audio` is no longer implied by `2d`, `3d`, or `ui`.
- `ui` is no longer implied by `2d` or `3d`.
- Profile collections must be used with `default-features = false`; otherwise default
  features remain enabled by Cargo feature unification.
- Native controller events need the `bevy_gilrs` backend when defaults are disabled.
- `bevy_capture 0.6` and `bevy_hanabi 0.19` target Bevy 0.19. Verify every other
  dependency's declared Bevy version rather than guessing from its crate version.

## Other source migrations

- `InputFocus` is initialized by `DefaultPlugins`. In Bevy 0.19.1, call
  `focus.set(entity, FocusCause::Navigated)`; the one-argument 0.19.0 example is
  patch-stale.
- Recalculate serialized `AnimationTargetId` values: its hash/ID algorithm changed.
- A glTF `#Material0` label now returns `GltfMaterial`; append `/std` for a
  `Handle<StandardMaterial>` when PBR conversion is enabled.
- Advanced loads now go through `AssetServer::load_builder`; nested loads use
  `LoadContext::load_builder`.
- `EasyScreenRecordPlugin` manual literals need `output_dir`; `..default()` already
  supplies it.
- `FeathersPlugin` became `FeathersCorePlugin`, while `FeathersPlugins` remains the
  plugin group.

See [rendering, assets, and APIs](references/rendering-assets-and-api.md).

## Validate the migration

```sh
cargo check --all-targets
cargo test
cargo tree -d | rg 'bevy(_| )'
```

Treat duplicate Bevy majors/minors as a compatibility problem, not harmless Cargo
noise. Also build every supported feature profile and target; a default desktop build
does not validate `default-features = false` or WASM.

## See also

- [Official Bevy migration guide](https://bevy.org/learn/migration-guides/0-18-to-0-19/)
- [`bevy-cargo-features`](../bevy-cargo-features/SKILL.md)
- [`bevy-rendering`](../bevy-rendering/SKILL.md)
- [`bevy-ui`](../bevy-ui/SKILL.md)
- [`bevy-assets`](../bevy-assets/SKILL.md)
- [`bevy-ecs-queries`](../bevy-ecs-queries/SKILL.md)
