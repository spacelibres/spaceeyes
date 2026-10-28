// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded PNG/JPEG import outside the core. No filesystem, registry, or ICC conversion.
use image::{metadata::Orientation, DynamicImage, ImageDecoder};
use spaceeyes_geometry::{ColorSpace, TextureData};
use std::io::Cursor;
use zune_core::{
    bytestream::ZCursor, colorspace::ColorSpace as JpegColor, options::DecoderOptions,
};

pub const MAX_ENCODED_BYTES: usize = 8 * 1024 * 1024;
const MAX_DIMENSION: u32 = 2048;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportError {
    InputSize,
    UnsupportedFormat,
    InvalidImage,
    UnsupportedPrecision,
    UnsupportedAnimation,
    UnsupportedTransparency,
}
impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "image import: {self:?}")
    }
}
impl std::error::Error for ImportError {}

/// Decode opaque 8-bit PNG/JPEG. Color space is caller policy, not inferred from metadata.
/// Input/extent limits are hard checks; codec allocation guidance is not process isolation.
pub fn decode(bytes: &[u8], color_space: ColorSpace) -> Result<TextureData, ImportError> {
    if bytes.is_empty() || bytes.len() > MAX_ENCODED_BYTES {
        return Err(ImportError::InputSize);
    }
    let image = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        // Require the complete standard IEND chunk, including its CRC.
        if !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82") {
            return Err(ImportError::InvalidImage);
        }
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(MAX_DIMENSION);
        limits.max_image_height = Some(MAX_DIMENSION);
        limits.max_alloc = Some(64 * 1024 * 1024);
        let decoder = image::codecs::png::PngDecoder::with_limits(Cursor::new(bytes), limits)
            .map_err(|_| ImportError::InvalidImage)?;
        if decoder.is_apng().map_err(|_| ImportError::InvalidImage)? {
            return Err(ImportError::UnsupportedAnimation);
        }
        if decoder.color_type().bits_per_pixel() / decoder.color_type().channel_count() as u16 > 8 {
            return Err(ImportError::UnsupportedPrecision);
        }
        DynamicImage::from_decoder(decoder).map_err(|_| ImportError::InvalidImage)?
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        if !bytes.ends_with(&[0xff, 0xd9]) {
            return Err(ImportError::InvalidImage);
        }
        let options = DecoderOptions::default()
            .set_strict_mode(true)
            .set_max_width(MAX_DIMENSION as usize)
            .set_max_height(MAX_DIMENSION as usize)
            .jpeg_set_out_colorspace(JpegColor::RGBA);
        let mut decoder = zune_jpeg::JpegDecoder::new_with_options(ZCursor::new(bytes), options);
        decoder
            .decode_headers()
            .map_err(|_| ImportError::InvalidImage)?;
        let info = decoder.info().ok_or(ImportError::InvalidImage)?;
        if info.width == 0
            || info.height == 0
            || u32::from(info.width) > MAX_DIMENSION
            || u32::from(info.height) > MAX_DIMENSION
        {
            return Err(ImportError::InvalidImage);
        }
        let orientation = decoder
            .exif()
            .and_then(|data| Orientation::from_exif_chunk(data))
            .unwrap_or(Orientation::NoTransforms);
        let pixels = decoder.decode().map_err(|_| ImportError::InvalidImage)?;
        let mut image = DynamicImage::ImageRgba8(
            image::RgbaImage::from_raw(info.width.into(), info.height.into(), pixels)
                .ok_or(ImportError::InvalidImage)?,
        );
        image.apply_orientation(orientation);
        image
    } else {
        return Err(ImportError::UnsupportedFormat);
    };
    let rgba = image.into_rgba8();
    if rgba.pixels().any(|p| p[3] != 255) {
        return Err(ImportError::UnsupportedTransparency);
    }
    TextureData::new(rgba.width(), rgba.height(), rgba.into_raw(), color_space)
        .map_err(|_| ImportError::InvalidImage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{
        codecs::{jpeg::JpegEncoder, png::PngEncoder},
        ExtendedColorType, ImageEncoder,
    };
    fn png(pixels: &[u8], width: u32, height: u32, color: ExtendedColorType) -> Vec<u8> {
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(pixels, width, height, color)
            .unwrap();
        bytes
    }
    fn jpeg(exif: Option<Vec<u8>>) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 100);
        if let Some(exif) = exif {
            encoder.set_exif_metadata(exif).unwrap();
        }
        encoder
            .write_image(&[200, 40, 20, 200, 40, 20], 2, 1, ExtendedColorType::Rgb8)
            .unwrap();
        bytes
    }
    #[test]
    fn png_preserves_pixels_and_explicit_color_policy() {
        let pixels = [12, 34, 56, 255, 78, 90, 123, 255];
        let bytes = png(&pixels, 2, 1, ExtendedColorType::Rgba8);
        for color in [ColorSpace::Linear, ColorSpace::Srgb] {
            let texture = decode(&bytes, color).unwrap();
            assert_eq!((texture.width(), texture.height()), (2, 1));
            assert_eq!(texture.rgba8(), pixels);
            assert_eq!(texture.color_space(), color);
        }
        assert_eq!(
            decode(&png(&[23], 1, 1, ExtendedColorType::L8), ColorSpace::Linear)
                .unwrap()
                .rgba8(),
            &[23, 23, 23, 255]
        );
    }
    #[test]
    fn rejects_transparency_and_sixteen_bit_precision() {
        assert_eq!(
            decode(
                &png(&[1, 2, 3, 254], 1, 1, ExtendedColorType::Rgba8),
                ColorSpace::Linear
            ),
            Err(ImportError::UnsupportedTransparency)
        );
        assert_eq!(
            decode(
                &png(&[0, 1], 1, 1, ExtendedColorType::L16),
                ColorSpace::Linear
            ),
            Err(ImportError::UnsupportedPrecision)
        );
    }
    #[test]
    fn jpeg_decodes_opaque_pixels_and_applies_exif_rotation() {
        let original = decode(&jpeg(None), ColorSpace::Srgb).unwrap();
        assert_eq!((original.width(), original.height()), (2, 1));
        for p in original.rgba8().as_chunks::<4>().0 {
            for (actual, expected) in p.iter().zip([200u8, 40, 20, 255]) {
                assert!(actual.abs_diff(expected) <= 3);
            }
        }
        // Little-endian TIFF: one SHORT orientation tag, value 6 (90 degrees clockwise).
        let exif = vec![
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ];
        let rotated = decode(&jpeg(Some(exif)), ColorSpace::Srgb).unwrap();
        assert_eq!((rotated.width(), rotated.height()), (1, 2));
        assert_eq!(rotated.rgba8(), original.rgba8());
    }
    #[test]
    fn rejects_truncated_corrupt_and_unsupported_images() {
        let valid = png(&[10, 20, 30], 1, 1, ExtendedColorType::Rgb8);
        for end in [8, 20, valid.len() - 1, valid.len() - 12] {
            assert!(decode(&valid[..end], ColorSpace::Linear).is_err());
        }
        let mut corrupt = valid.clone();
        corrupt[29] ^= 1; // IHDR checksum must remain enabled.
        assert!(decode(&corrupt, ColorSpace::Linear).is_err());
        let mut jpg = jpeg(None);
        jpg.truncate(jpg.len() - 2);
        assert!(decode(&jpg, ColorSpace::Linear).is_err());
        assert!(decode(&[0xff, 0xd8, 0, 0, 0xff, 0xd9], ColorSpace::Linear).is_err());
        let mut corrupt_pixels = valid.clone();
        let idat = corrupt_pixels
            .windows(4)
            .position(|w| w == b"IDAT")
            .unwrap();
        corrupt_pixels[idat + 4] ^= 1;
        assert!(decode(&corrupt_pixels, ColorSpace::Linear).is_err());
        assert_eq!(
            decode(b"GIF89a", ColorSpace::Linear),
            Err(ImportError::UnsupportedFormat)
        );
        assert_eq!(decode(&[], ColorSpace::Linear), Err(ImportError::InputSize));
        assert_eq!(
            decode(&vec![0; MAX_ENCODED_BYTES + 1], ColorSpace::Linear),
            Err(ImportError::InputSize)
        );
    }
    #[test]
    fn rejects_animated_png() {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_animated(2, 0).unwrap();
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[255, 0, 0]).unwrap();
            writer.write_image_data(&[0, 0, 255]).unwrap();
            writer.finish().unwrap();
        }
        assert_eq!(
            decode(&bytes, ColorSpace::Srgb),
            Err(ImportError::UnsupportedAnimation)
        );
    }
    #[test]
    fn rejects_dimensions_before_pixel_decode() {
        let oversized = png(&vec![42; 2049], 2049, 1, ExtendedColorType::L8);
        assert!(decode(&oversized, ColorSpace::Linear).is_err());
    }
}
