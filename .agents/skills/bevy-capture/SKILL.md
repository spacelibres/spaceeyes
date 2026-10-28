---
name: bevy-capture
description: Use when adding `CapturePlugin`, attaching `CaptureBundle` and `RenderTarget::target_headless` to a camera, starting or stopping `Capture`, choosing `Mp4Openh264Encoder`/`Mp4FfmpegCliPipeEncoder`/`FramesEncoder`, or diagnosing empty off-screen recordings in Bevy 0.19.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "4"
  area: render
  bevy_version: "0.19"
---

# bevy-capture — recording Bevy 0.19 cameras

## When to use this skill

- Record deterministic gameplay, cinematics, or render-test evidence.
- Capture a headless `Camera2d`/`Camera3d` to MP4, GIF, or numbered PNGs.
- Choose between in-process OpenH264, ffmpeg, and lossless frame output.
- Diagnose a missing encoder module, an empty output, or an unflushed recording.

`bevy_capture = "0.6"` natively targets Bevy 0.19. Do not carry forward the
0.4.x Bevy patch or its old `CameraTargetHeadless` API.

## Canonical pattern

```toml
[dependencies]
bevy = "0.19"
bevy_capture = { version = "0.6", features = ["mp4_openh264"] }
```

```rust
use bevy::{
    app::{RunMode, ScheduleRunnerPlugin},
    camera::RenderTarget,
    prelude::*,
    render::RenderPlugin,
    winit::WinitPlugin,
};
use bevy_capture::{
    encoder::mp4_openh264::Mp4Openh264Encoder,
    Capture, CaptureBundle, CapturePlugin, RenderTargetHeadless,
};
use std::fs::{self, File};

const WIDTH: u16 = 1280;
const HEIGHT: u16 = 720;

fn main() -> AppExit {
    App::new()
        .add_plugins((
            DefaultPlugins.build().disable::<WinitPlugin>().set(RenderPlugin {
                synchronous_pipeline_compilation: true,
                ..default()
            }),
            ScheduleRunnerPlugin {
                run_mode: RunMode::Loop { wait: None },
            },
            CapturePlugin,
        ))
        .add_systems(Startup, setup)
        .add_systems(Update, record)
        .run()
}

fn setup(mut commands: Commands, mut images: ResMut<Assets<Image>>) {
    commands.spawn((
        Camera2d,
        RenderTarget::target_headless(WIDTH.into(), HEIGHT.into(), &mut images),
        CaptureBundle::default(),
    ));
}

fn record(
    mut captures: Query<&mut Capture>,
    mut waited_for_pipeline: Local<bool>,
    mut frame: Local<u32>,
) {
    // Allow the render pipeline one frame to become ready.
    if !*waited_for_pipeline {
        *waited_for_pipeline = true;
        return;
    }

    let Ok(mut capture) = captures.single_mut() else { return };
    if !capture.is_capturing() && *frame == 0 {
        fs::create_dir_all("captures").expect("create captures directory");
        let encoder = Mp4Openh264Encoder::new(
            File::create("captures/run.mp4").expect("create output"),
            WIDTH,
            HEIGHT,
        )
        .expect("initialize OpenH264");
        capture.start(encoder);
    }

    *frame += 1;
    if *frame == 300 {
        capture.stop(); // drops the encoder and finalizes the MP4
    }
}
```

## Encoder choice

| Encoder | Feature | External program | Best fit |
|---|---|---|---|
| `Mp4Openh264Encoder` | `mp4_openh264` | No | In-process H.264 |
| `Mp4FfmpegCliEncoder` | `mp4_ffmpeg_cli` | `ffmpeg` | Short/offline clips |
| `Mp4FfmpegCliPipeEncoder` | `mp4_ffmpeg_cli_pipe` | `ffmpeg` | Long streaming captures |
| `GifEncoder` | `gif` | No | Small previews |
| `FramesEncoder` | none | No | Lossless PNG sequence |

See [encoder details](references/encoders.md) before choosing a production
codec or distribution model.

## Gotchas

- `RenderTargetHeadless` is implemented for `RenderTarget`; call
  `RenderTarget::target_headless(...)`. The old helper on `Camera` is stale.
- Attach `Camera2d`/`Camera3d`, the headless `RenderTarget`, and
  `CaptureBundle` to the same entity.
- Wait at least one frame before starting. Synchronous pipeline compilation
  improves deterministic batch capture but can increase startup time.
- Encoder modules are feature-gated. Enable exactly the features you import.
- `Capture::stop()` or dropping `Capture` finalizes encoders. Abrupt process
  termination can leave an invalid MP4 or GIF.
- The ffmpeg encoders require `ffmpeg` on `PATH`; constructors return `Result`.
- Match the encoder dimensions to the headless target. OpenH264 takes `u16`.
- Browser WASM has no ordinary filesystem or child processes. Design an
  explicit JS download/streaming path instead of assuming these encoders work.

## See also

- [`bevy-cameras`](../bevy-cameras/SKILL.md) — cameras and render targets.
- [`bevy-cargo-features`](../bevy-cargo-features/SKILL.md) — feature selection.
- [`bevy-wasm-webgpu`](../bevy-wasm-webgpu/SKILL.md) — browser constraints.
- [Encoder comparison](references/encoders.md).
- [0.19 compatibility](references/compatibility.md).
