// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Immutable opaque texture texels; image codecs and GPU objects live outside this domain.
use spaceeyes_foundation::CoreError;
pub const MAX_TEXTURE_DIMENSION: u32 = 2048;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColorSpace {
    Linear,
    Srgb,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureFilter {
    Nearest,
    Linear,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextureAddress {
    Clamp,
    Repeat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sampling {
    pub filter: TextureFilter,
    pub address: TextureAddress,
}
impl Default for Sampling {
    fn default() -> Self {
        Self {
            filter: TextureFilter::Nearest,
            address: TextureAddress::Clamp,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextureData {
    width: u32,
    height: u32,
    rgba8: Vec<u8>,
    color_space: ColorSpace,
}
impl TextureData {
    pub fn new(
        width: u32,
        height: u32,
        rgba8: Vec<u8>,
        color_space: ColorSpace,
    ) -> Result<Self, CoreError> {
        if !(1..=MAX_TEXTURE_DIMENSION).contains(&width)
            || !(1..=MAX_TEXTURE_DIMENSION).contains(&height)
            || rgba8.len() as u64 != u64::from(width) * u64::from(height) * 4
            || rgba8.as_chunks::<4>().0.iter().any(|p| p[3] != 255)
        {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            width,
            height,
            rgba8,
            color_space,
        })
    }
    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn rgba8(&self) -> &[u8] {
        &self.rgba8
    }
    pub fn color_space(&self) -> ColorSpace {
        self.color_space
    }
    pub fn byte_len(&self) -> u64 {
        self.rgba8.len() as u64
    }
}
