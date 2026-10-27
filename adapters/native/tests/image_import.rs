// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
#![cfg(feature = "gpu")]
use image::{
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
    ExtendedColorType, ImageEncoder,
};
use std::{
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn native_imports_png_and_jpeg_renders_and_preserves_invalid_input() {
    let dir = std::env::temp_dir().join(format!(
        "spaceeyes-import-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&dir).unwrap();
    let mut outputs = Vec::new();
    for jpeg in [false, true] {
        let mut encoded = Vec::new();
        let pixels = [240, 30, 10, 240, 30, 10];
        if jpeg {
            JpegEncoder::new_with_quality(&mut encoded, 100)
                .write_image(&pixels, 2, 1, ExtendedColorType::Rgb8)
                .unwrap();
        } else {
            PngEncoder::new(&mut encoded)
                .write_image(&pixels, 2, 1, ExtendedColorType::Rgb8)
                .unwrap();
        }
        let input = dir.join(if jpeg { "input.jpg" } else { "input.png" });
        let output = dir.join(if jpeg { "jpeg.ppm" } else { "png.ppm" });
        std::fs::write(&input, &encoded).unwrap();
        let run = Command::new(env!("CARGO_BIN_EXE_spaceeyes-native"))
            .args([output.to_str().unwrap(), "0", "0", input.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(
            run.status.success(),
            "{}",
            String::from_utf8_lossy(&run.stderr)
        );
        let log = String::from_utf8_lossy(&run.stdout);
        assert!(
            log.contains("retained asset bytes: 728; temporary resource bytes: 0"),
            "{log}"
        );
        let frame = std::fs::read(&output).unwrap();
        assert!(frame.starts_with(b"P6\n512 512\n255\n"));
        assert_eq!(frame.len(), 15 + 512 * 512 * 3);
        // The textured sphere appears left of center; imported red dominates its lit surface.
        let offset = 15 + (256 * 512 + 225) * 3;
        assert!(frame[offset] > frame[offset + 1] * 2 && frame[offset] > frame[offset + 2] * 2);
        outputs.push(frame);
        let same = Command::new(env!("CARGO_BIN_EXE_spaceeyes-native"))
            .args([input.to_str().unwrap(), "0", "0", input.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(!same.status.success());
        assert_eq!(std::fs::read(&input).unwrap(), encoded);
    }
    assert!(outputs[0]
        .iter()
        .zip(&outputs[1])
        .all(|(a, b)| a.abs_diff(*b) <= 3));
    let input = dir.join("invalid.png");
    let output = dir.join("preserved.ppm");
    std::fs::write(&input, b"not an image").unwrap();
    std::fs::write(&output, b"preserve existing output").unwrap();
    let invalid = Command::new(env!("CARGO_BIN_EXE_spaceeyes-native"))
        .args([output.to_str().unwrap(), "0", "0", input.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(!invalid.status.success());
    assert_eq!(std::fs::read(output).unwrap(), b"preserve existing output");
    std::fs::remove_dir_all(dir).unwrap();
}
