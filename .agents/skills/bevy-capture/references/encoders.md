# bevy-capture — Encoder comparison (deep dive)

> Referenced from `bevy-capture/SKILL.md § Encoder choice`.

## Mp4Openh264Encoder

The headline differentiator of `bevy_capture`: **in-process encoding with no
`ffmpeg` command at runtime**. The encoder uses the `openh264` / `openh264-sys2`
dependency chain; validate its native-library packaging on every shipping target.

**Cargo feature:** `mp4_openh264`.

**Construction:** `Mp4Openh264Encoder::new(writer, width, height) -> Result<Self, _>`. The writer implements `Write + Seek` (for example `std::fs::File`) and dimensions are `u16`.

**Distribution note:** H.264 patent/licensing and OpenH264 binary redistribution
requirements are product- and territory-sensitive. Have release/legal owners review
the exact binary and distribution path; the Rust crate's license is not the whole
codec-distribution analysis.

**Typical use:**
- CI pipelines generating test output MP4s without installing `ffmpeg`.
- Native tools that need predictable in-process encoding without an installed CLI.

## Mp4FfmpegCliEncoder

Writes numbered PNG frames to a temporary directory during the run, then shells out
to `ffmpeg` **once** when `Capture::stop()` is called or the encoder is dropped.
Quality and codec options are configurable via builder methods.

**Cargo feature:** `mp4_ffmpeg_cli`.

**Construction:** `Mp4FfmpegCliEncoder::new(path) -> Result<Self, _>` then chain `.with_framerate(fps)`, `.with_crf(crf)`, etc.

**Requirement:** `ffmpeg` on `$PATH` when stop/flush occurs.

**Pros:** Full ffmpeg codec + filter graph access; good for offline batch renders.
**Cons:** Keeps every PNG until finalization, so long captures can consume substantial
temporary-disk space.

## Mp4FfmpegCliPipeEncoder

Spawns a long-running `ffmpeg` child when the first frame is encoded and pipes raw
RGBA frames to its stdin. The child writes the MP4 incrementally.

**Cargo feature:** `mp4_ffmpeg_cli_pipe` (a *separate* feature from `mp4_ffmpeg_cli` — enabling one does not enable the other).

**Construction:** `Mp4FfmpegCliPipeEncoder::new(path) -> Result<Self, _>` then chain `.with_framerate`, `.with_crf`, `.with_preset(String)`, etc.

**Requirement:** `ffmpeg` on `$PATH` when the first frame is encoded.

**Pros:** Memory-efficient for long recordings; output file grows incrementally.
**Cons:** Any ffmpeg crash mid-run corrupts the output. Pipe backpressure can stall the render loop on slow storage.

## FramesEncoder

Writes one PNG per rendered frame into a specified output directory. No video encoding at all — downstream tools (ffmpeg, gifski, DaVinci Resolve, ImageMagick) consume the sequence.

**Cargo feature:** *(none — always available).*

**Construction:** `FramesEncoder::new(dir_path)`. The directory is created at first frame; no `Result`.

**Pros:** Lossless; zero external programs; trivial to debug — you can open frame N in any viewer. **Browser note:** the implementation writes through `std::fs`; a browser build needs a separate JS download or streaming bridge rather than an ordinary path.
**Cons:** Large output (3–10× MP4 for the same content); must be assembled into video separately.

## Choosing in practice

```
Need browser delivery?                → Design a JS download/streaming bridge
Need in-process, no system deps?       → Mp4Openh264Encoder
Need ffmpeg codec control, short clip? → Mp4FfmpegCliEncoder
Need ffmpeg, memory-efficient, long?   → Mp4FfmpegCliPipeEncoder
```

## See also

- [`SKILL.md`](../SKILL.md) — dispatcher with canonical pattern.
- [`compatibility.md`](compatibility.md) — native Bevy 0.19 support in version 0.6.
