// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded upload wire mapping; ResourceManager owns bytes and integrity.
use crate::{generated as p, ProtocolError};
use spaceeyes_geometry::ColorSpace;
use spaceeyes_resources::{ImageCodec, UploadDescriptor, UploadFormat, UploadSource, UploadStatus};
pub(crate) fn validate_upload_id(id: &str) -> Result<(), ProtocolError> {
    if id.trim().is_empty() || id.len() > crate::limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidIdentifier);
    }
    Ok(())
}
pub(crate) fn decode_descriptor(
    value: p::BeginResourceUpload,
) -> Result<UploadDescriptor, ProtocolError> {
    let source = value.source.ok_or(ProtocolError::MissingField)?;
    let format = match p::ResourceUploadFormat::try_from(value.format) {
        Ok(p::ResourceUploadFormat::Bytes)
            if value.width == 0 && value.height == 0 && value.color_space == 0 =>
        {
            UploadFormat::Blob
        }
        Ok(p::ResourceUploadFormat::Rgba8) => UploadFormat::Rgba8 {
            width: value.width,
            height: value.height,
            color_space: match p::TextureColorSpace::try_from(value.color_space) {
                Ok(p::TextureColorSpace::Linear) => ColorSpace::Linear,
                Ok(p::TextureColorSpace::Srgb) => ColorSpace::Srgb,
                _ => return Err(ProtocolError::InvalidContext),
            },
        },
        Ok(p::ResourceUploadFormat::Png | p::ResourceUploadFormat::Jpeg)
            if value.width == 0 && value.height == 0 =>
        {
            UploadFormat::EncodedImage {
                codec: if p::ResourceUploadFormat::try_from(value.format)
                    == Ok(p::ResourceUploadFormat::Png)
                {
                    ImageCodec::Png
                } else {
                    ImageCodec::Jpeg
                },
                color_space: match p::TextureColorSpace::try_from(value.color_space) {
                    Ok(p::TextureColorSpace::Linear) => ColorSpace::Linear,
                    Ok(p::TextureColorSpace::Srgb) => ColorSpace::Srgb,
                    _ => return Err(ProtocolError::InvalidContext),
                },
            }
        }
        _ => return Err(ProtocolError::InvalidContext),
    };
    Ok(UploadDescriptor {
        resource_id: crate::decode_resource_id(
            value.resource_id.ok_or(ProtocolError::MissingField)?,
        )?,
        total_bytes: value.total_bytes,
        source: UploadSource {
            source_id: source.source_id,
            source_version: source.source_version,
            sha256: source
                .sha256
                .try_into()
                .map_err(|_| ProtocolError::InvalidContext)?,
        },
        format,
    })
}
pub(crate) fn encode_status(value: &UploadStatus) -> p::ResourceUploadStatus {
    let (format, width, height, color_space) = match value.descriptor.format {
        UploadFormat::Blob => (p::ResourceUploadFormat::Bytes, 0, 0, 0),
        UploadFormat::Rgba8 {
            width,
            height,
            color_space,
        } => (
            p::ResourceUploadFormat::Rgba8,
            width,
            height,
            match color_space {
                ColorSpace::Linear => p::TextureColorSpace::Linear as i32,
                ColorSpace::Srgb => p::TextureColorSpace::Srgb as i32,
            },
        ),
        UploadFormat::EncodedImage { codec, color_space } => (
            match codec {
                ImageCodec::Png => p::ResourceUploadFormat::Png,
                ImageCodec::Jpeg => p::ResourceUploadFormat::Jpeg,
            },
            0,
            0,
            match color_space {
                ColorSpace::Linear => p::TextureColorSpace::Linear as i32,
                ColorSpace::Srgb => p::TextureColorSpace::Srgb as i32,
            },
        ),
    };
    let source = &value.descriptor.source;
    p::ResourceUploadStatus {
        upload_id: value.upload_id.clone(),
        resource_id: Some(p::ResourceId {
            value: value.descriptor.resource_id.as_str().into(),
        }),
        received_bytes: value.received_bytes,
        total_bytes: value.descriptor.total_bytes,
        source: Some(p::ResourceSource {
            source_id: source.source_id.clone(),
            source_version: source.source_version.clone(),
            sha256: source.sha256.to_vec(),
        }),
        format: format as i32,
        width,
        height,
        color_space,
    }
}
