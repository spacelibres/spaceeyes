---
name: bevy-assets
description: Use when loading with `AssetServer`, holding `Handle<T>`, spawning Bevy 0.19 glTF `WorldAsset` scenes, reading `Assets<T>`, enabling hot reload, configuring `AssetServer::load_builder`, resolving `AssetPath`, or implementing a `Reader::seekable` backend.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: asset
  bevy_version: "0.19"
---

# Bevy 0.19 — Assets

## When to use this skill

- Loading a model, texture, audio file, or scene.
- Reading the loaded data back from `Assets<T>` once it's ready.
- Reacting to load progress (`AssetEvent::Added` / `Modified`).
- Spawning glTF scenes, waiting for `WorldInstanceReady`, reading names/extras, or
  owning/despawning an instance cleanly.
- Enabling hot-reload during development.
- Writing your own loader → see `bevy-custom-assets`.

## Canonical pattern

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(AssetPlugin {
            // Hot-reload on file change — dev-only.
            watch_for_changes_override: Some(true),
            ..default()
        }))
        .init_resource::<MyHandles>()
        .add_systems(Startup, load_handles)
        .add_systems(Update, react_to_loads)
        .run();
}

#[derive(Resource, Default)]
struct MyHandles {
    hero: Handle<WorldAsset>,
    bricks: Handle<Image>,
}

fn load_handles(asset_server: Res<AssetServer>, mut handles: ResMut<MyHandles>) {
    // GLTF scenes are addressed by sub-asset label.
    handles.hero = asset_server.load("models/hero.glb#Scene0");
    handles.bricks = asset_server.load("textures/bricks.png");
}

fn react_to_loads(
    mut ev: MessageReader<AssetEvent<Image>>,
    images: Res<Assets<Image>>,
) {
    for event in ev.read() {
        if let AssetEvent::LoadedWithDependencies { id } = event {
            if let Some(img) = images.get(*id) {
                info!("image loaded: {}x{}", img.width(), img.height());
            }
        }
    }
}
```

## Asset paths

```rust
use bevy::asset::AssetPath;

// `LoadContext::path()` returns `AssetPath`, not `&Path`.
// Build paths explicitly when generating handles inside a custom loader:
let path = AssetPath::from("textures/bricks.png");
let path_with_label = AssetPath::from("models/hero.glb").with_label("Scene0");
let _ = path;
let _ = path_with_label;
```

## Asset readiness check

```rust
use bevy::prelude::*;

# fn _check(
asset_server: Res<AssetServer>,
handles: Res<MyHandles>,
# ) {
use bevy::asset::LoadState;

if asset_server.load_state(&handles.hero) == LoadState::Loaded {
    // Safe to spawn WorldAssetRoot(handles.hero.clone()).
}
# }
# #[derive(Resource)] struct MyHandles { hero: Handle<WorldAsset> }
```

## Bevy 0.19 gotchas

- **`LoadContext::path()` returns `AssetPath`**, not `&Path`. Callers that did `ctx.path().to_string_lossy()` need to `ctx.path().path().to_string_lossy()` or use the `AssetPath` API directly.
- **`SeekableReader`** is new in 0.18. Loaders that need random access into the underlying file can ask: `if let Ok(s) = reader.seekable() { /* s: &mut dyn SeekableReader */ }`.
- **Every custom `Reader` implements `seekable()` in 0.19.** Return `Ok(self)` when it also implements `AsyncSeek`; otherwise return `Err(ReaderNotSeekableError)`. `AsyncSeekForward` was removed.
- **Advanced loads use builders in 0.19.** Prefer `AssetServer::load_builder()` for settings, guards, untyped loads, or approval overrides; the many specialized `load_*` variants are deprecated.
- **`AssetPath::resolve` now takes `&AssetPath`.** Use `resolve_str`/`resolve_embed_str` when the child path starts as text.
- **`AssetSourceBuilder::new(...)`** replaces `AssetSource::build().with_reader(...)`. Existing custom asset sources need to be re-shaped.
- **`AssetSource` channel is `async_channel::Sender`** in 0.18 (was `crossbeam_channel`). Use `send_blocking(...)`.
- **`Image::reinterpret_size(size)` returns `Result`** in 0.18.
- **Sub-asset labels.** `path.glb#Scene0`, `path.glb#Mesh0/Primitive0` — distinct handles, can be loaded independently. Forgetting the label gives you the *root* asset, not the named one.
- **Hot reload is dev-only.** Don't ship `watch_for_changes_override: Some(true)` in a release build — it polls the filesystem.
- **`asset_server.load(...)` is non-blocking.** Querying `Assets<T>::get` immediately after returns `None`. Wait for `AssetEvent::LoadedWithDependencies` or poll `load_state(...)`.
- **`AssetEvent<T>` is a `Message`**, so iterate with `MessageReader<AssetEvent<T>>`, not the old `EventReader`.

## See also

- [glTF scenes](references/gltf-scenes.md) — `GltfAssetLabel`, `WorldAssetRoot`,
  instance readiness/ownership, names/extras, metadata proxies, and despawning.
- `bevy-custom-assets` — writing an `AssetLoader` and nested load builder.
- [`bevy-save-load`](../bevy-save-load/SKILL.md) — durable stable IDs and save schema;
  glTF names/entity IDs are not persistence contracts.
- `bevy-migration-0-17-to-0-18` — `LoadContext::path` and channel-type renames.
- `bevy-migration-0-18-to-0-19` — load builders and required `Reader::seekable`.
