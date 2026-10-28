---
name: bevy-cargo-features
description: Use when selecting Bevy 0.19 Cargo features such as `2d`/`3d`/`ui`/`audio`, composing `3d_bevy_render` or API-only `3d_api`, building headless with `default_app`, enabling `bevy_gilrs`, or debugging missing UI/audio/input after `default-features = false`.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: cargo
  bevy_version: "0.19"
---

# Bevy 0.19 — Cargo features

## When to use this skill

- Choose a supported application profile without enabling the full default set.
- Compose a custom renderer or a headless server.
- Enable native controller input, window/input APIs, or browser rendering.
- Diagnose types/plugins missing after disabling default features.

## Canonical profiles

Bevy's default is `2d + 3d + ui + audio`. To select a profile, disabling
defaults is essential:

```toml
# 3D game with Bevy UI, but no audio or 2D renderer
bevy = { version = "0.19", default-features = false, features = ["3d", "ui"] }

# 2D game with audio, but no 3D renderer or UI
# bevy = { version = "0.19", default-features = false, features = ["2d", "audio"] }
```

Writing `features = ["3d"]` while leaving default features enabled does not
trim anything: Cargo unions feature sets.

## Collection layers

| Layer | Features | Meaning |
|---|---|---|
| Profiles | `2d`, `3d`, `ui`, `audio` | Complete app shapes |
| Built-in render | `2d_bevy_render`, `3d_bevy_render`, `ui_bevy_render` | Bevy's renderer for one domain |
| API only | `2d_api`, `3d_api`, `ui_api` | Components/assets without a render backend |
| Baseline | `default_app`, `default_platform` | Core app services vs platform/window/input services |
| Grouped | `scene`, `picking`, `dev` | Related feature collections |

API-only features cannot draw. They are for custom/external renderers that
consume Bevy's world-side types.

## Headless server

```toml
bevy = { version = "0.19", default-features = false, features = [
    "default_app",
    "multi_threaded",
    "serialize",
    "bevy_world_serialization", # omit if the server never loads saved worlds
] }
```

Use `MinimalPlugins`, then add only the service plugins the server needs.
`bevy_scene` is BSN in 0.19; classic reflected world serialization is
`bevy_world_serialization`.

## Custom renderer

```toml
bevy = { version = "0.19", default-features = false, features = [
    "default_app",
    "3d_api",
] }
```

Add `bevy_winit`/platform input only if the custom renderer shares Bevy's
window event loop. Add `3d_bevy_render` instead of `3d_api` if you actually want
Bevy's built-in renderer.

## Input and controllers

- `mouse`, `keyboard`, `gamepad`, `touch`, and `gestures` enable API pieces.
- For native controller discovery/input, enable `bevy_gilrs`; it also enables
  `gamepad`. The `gamepad` feature alone is not the platform backend.
- The high-level `default_platform` collection includes `bevy_gilrs`, Winit,
  desktop window backends, default font, and `webgl2`.

## Browser profile

```toml
bevy = { version = "0.19", default-features = false, features = [
    "3d",
    "ui",
    "touch",
    # "webgpu", # overrides WebGL2; use a separate WebGPU artifact
] }
```

The `3d` profile already includes the default platform and WebGL2 path. Enabling
`webgpu` overrides `webgl2`; it is not a runtime fallback build. See
[`bevy-wasm-webgpu`](../bevy-wasm-webgpu/SKILL.md).

## 0.19 implications and traps

- `2d` and `3d` no longer imply `ui`; add `ui` explicitly.
- `2d`, `3d`, and `ui` no longer imply `audio`; add `audio` or a lower-level
  codec combination explicitly.
- `scene` now enables both `bevy_world_serialization` and the new BSN
  `bevy_scene`.
- Keep `dev`, `dynamic_linking`, file watchers, tracing, and dev tools behind a
  project development feature; do not ship them accidentally.
- Native Linux window backends are `x11` and `wayland`; target-specific mobile
  activity features are mutually exclusive where documented. Do not invent
  `windows` or `macos` Bevy feature names.
- Profile collections are the stable starting point. Use lower-level
  collections only when compile time, binary size, or a custom renderer makes
  the maintenance cost worthwhile.

## See also

- [`bevy-rendering`](../bevy-rendering/SKILL.md) — renderer decision boundary.
- [`bevy-wasm-webgpu`](../bevy-wasm-webgpu/SKILL.md) — browser build pipeline.
- [`bevy-a11y`](../bevy-a11y/SKILL.md) — input/backend requirements for accessibility.
- [`bevy-migration-0-18-to-0-19`](../bevy-migration-0-18-to-0-19/SKILL.md) — changed implications.
