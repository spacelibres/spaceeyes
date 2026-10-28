---
name: bevy-wasm-webgpu
description: Use when targeting Bevy 0.19 at `wasm32-unknown-unknown`, choosing the `webgl2` or `webgpu` feature, generating browser glue with `wasm-bindgen`, using a `wasm-release` profile, or debugging canvas startup and asset HTTP 404s.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: platform
  bevy_version: "0.19"
---

# Bevy 0.19 — browser WASM

## When to use this skill

- Build a Bevy client for `wasm32-unknown-unknown`.
- Choose the broadly compatible WebGL2 path or WebGPU path.
- Generate JS bindings, serve assets, and reduce artifact size.
- Diagnose missing canvas, insecure-context, codec, or asset-path failures.

## Canonical manifest

```toml
[package]
name = "myclient"
version = "0.1.0"
edition = "2024"

[dependencies]
bevy = { version = "0.19", default-features = false, features = [
    "3d",
    "ui",
    "touch",
] }

[profile.wasm-release]
inherits = "release"
opt-level = "z"
lto = "fat"
codegen-units = 1
strip = "debuginfo"
```

The `3d` profile supplies Bevy's renderer, Winit, and the default WebGL2 path.
Add `audio` only if needed; browser audio must begin after user interaction.

## Build and serve

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli

cargo build --profile wasm-release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-name myclient --out-dir public \
  target/wasm32-unknown-unknown/wasm-release/myclient.wasm

# Optional: install Binaryen first, then verify this actually reduces size.
wasm-opt -Oz public/myclient_bg.wasm -o public/myclient_bg.opt.wasm
mv public/myclient_bg.opt.wasm public/myclient_bg.wasm

python3 -m http.server --directory public 8080
```

Copy or link the project `assets/` directory to `public/assets/`; Bevy fetches
assets over HTTP relative to the served page/asset root.

## Minimal HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>My Bevy game</title>
    <style>html,body,#bevy{width:100%;height:100%;margin:0;background:#000}</style>
  </head>
  <body>
    <canvas id="bevy"></canvas>
    <script type="module">
      import init from "./myclient.js";
      await init();
    </script>
  </body>
</html>
```

Bind the primary window to that existing canvas. Otherwise `Window::default()` has
`canvas: None`, so Bevy/Winit creates and appends a second canvas:

```rust
use bevy::{prelude::*, window::WindowPlugin};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                canvas: Some("#bevy".into()),
                fit_canvas_to_parent: true,
                ..default()
            }),
            ..default()
        }))
        .run();
}
```

Serve over HTTP; opening the file directly does not provide the fetch and module
semantics the generated glue expects.

## WebGL2 versus WebGPU

| Choice | Cargo features | Choose when |
|---|---|---|
| WebGL2 | profile defaults / `webgl2` | Browser reach matters; no compute dependency |
| WebGPU | add `webgpu` | A tested target browser supports it and effects need compute |

In Bevy 0.19, `webgpu` overrides `webgl2`. One binary cannot dynamically fall
back between them. Produce two artifacts or choose one based on the supported
browser matrix. Check current browser support during release testing rather
than hard-coding browser-version claims in application logic.

## Gotchas

- `3d_api` only supplies types; it does not render. Use `3d` or compose
  `3d_bevy_render` with the app/platform collections.
- `default-features = false` matters. Cargo features are additive; adding `3d`
  without disabling defaults keeps the full default set.
- WebGL2 has no compute shaders. Hanabi and other compute-heavy plugins require
  the WebGPU artifact and their own current Bevy-compatible release.
- Browser filesystems and child processes are not native capabilities. Capture,
  save, and export flows need explicit web APIs/JS interop.
- Audio playback is normally blocked until a user gesture resumes the browser
  audio context.
- Asset 404s are deployment-layout errors: inspect the requested URL in browser
  devtools and make the served `assets/` tree match it.
- A configured `Window.canvas` selector must resolve before startup and cannot be
  changed later. If you omit it, remove any placeholder canvas and let Bevy append
  its own.
- Test on actual target browsers and GPUs. `cargo check` cannot validate adapter
  limits, shader translation, texture formats, or browser security policy.

## See also

- [`bevy-cargo-features`](../bevy-cargo-features/SKILL.md) — profile composition.
- [`bevy-rendering`](../bevy-rendering/SKILL.md) — renderer extension choices.
- [`bevy-assets`](../bevy-assets/SKILL.md) — asynchronous asset loading.
- [`bevy-vfx`](../bevy-vfx/SKILL.md) — compute-dependent effects.
