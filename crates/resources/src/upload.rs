// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded sequential uploads. The manager owns identity, reservations and unpublished bytes.
use crate::{Entry, ResourceClass, ResourceError, ResourceManager, ResourceState};
use sha2::{Digest, Sha256};
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{ColorSpace, TextureData, MAX_TEXTURE_DIMENSION};
use std::sync::Arc;

pub const MAX_UPLOAD_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_UPLOAD_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_UPLOAD_SESSIONS: usize = 4;
pub const MAX_SOURCE_ID_BYTES: usize = 256;
pub const MAX_SOURCE_VERSION_BYTES: usize = 128;
/// Encoded PNG/JPEG streams are bounded more tightly than raw uploads.
pub const MAX_ENCODED_IMAGE_BYTES: usize = spaceeyes_image_import::MAX_ENCODED_BYTES;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadSource {
    pub source_id: String,
    pub source_version: String,
    pub sha256: [u8; 32],
}

impl UploadSource {
    pub(crate) fn validate(&self) -> Result<(), ResourceError> {
        if self.source_id.trim().is_empty()
            || self.source_id.len() > MAX_SOURCE_ID_BYTES
            || self.source_version.trim().is_empty()
            || self.source_version.len() > MAX_SOURCE_VERSION_BYTES
        {
            return Err(ResourceError::InvalidSize);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageCodec {
    Png,
    Jpeg,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UploadFormat {
    Blob,
    Rgba8 {
        width: u32,
        height: u32,
        color_space: ColorSpace,
    },
    /// Bounded PNG/JPEG stream decoded by the core; dimensions are checked after decode.
    EncodedImage {
        codec: ImageCodec,
        color_space: ColorSpace,
    },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadDescriptor {
    pub resource_id: ResourceId,
    pub total_bytes: u64,
    pub source: UploadSource,
    pub format: UploadFormat,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadStatus {
    pub upload_id: String,
    pub descriptor: UploadDescriptor,
    pub received_bytes: u64,
}
#[derive(Clone)]
pub(crate) struct UploadSession {
    owner: String,
    status: UploadStatus,
    /// Host-supplied monotonic tick; 0 means the host did not stamp this session.
    created_tick: u64,
    // Staging a scene transaction clones metadata, never all active upload buffers.
    bytes: Arc<Vec<u8>>,
}
/// SHA-256 fingerprint shared by upload validation and bounded command history.
pub fn upload_digest(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
pub(crate) fn verify_digest(source: &UploadSource, bytes: &[u8]) -> Result<(), ResourceError> {
    if upload_digest(bytes) != source.sha256 {
        return Err(ResourceError::DigestMismatch);
    }
    Ok(())
}
impl ResourceManager {
    pub fn begin_upload(
        &mut self,
        owner: &str,
        descriptor: UploadDescriptor,
    ) -> Result<UploadStatus, ResourceError> {
        self.begin_upload_at(owner, descriptor, 0)
    }
    /// Stamp the session with a host monotonic tick so it can expire. A zero tick
    /// means the host opted out of wall-clock expiry for this session.
    pub fn begin_upload_at(
        &mut self,
        owner: &str,
        descriptor: UploadDescriptor,
        tick: u64,
    ) -> Result<UploadStatus, ResourceError> {
        if owner.trim().is_empty() || owner.len() > MAX_SOURCE_ID_BYTES {
            return Err(ResourceError::PermissionDenied);
        }
        descriptor.source.validate()?;
        let bytes = descriptor.total_bytes;
        if bytes == 0 || bytes > MAX_UPLOAD_BYTES {
            return Err(ResourceError::InvalidSize);
        }
        if let UploadFormat::Rgba8 { width, height, .. } = descriptor.format {
            if !(1..=MAX_TEXTURE_DIMENSION).contains(&width)
                || !(1..=MAX_TEXTURE_DIMENSION).contains(&height)
                || bytes != u64::from(width) * u64::from(height) * 4
            {
                return Err(ResourceError::InvalidSize);
            }
        }
        if matches!(descriptor.format, UploadFormat::EncodedImage { .. })
            && bytes > MAX_ENCODED_IMAGE_BYTES as u64
        {
            return Err(ResourceError::InvalidSize);
        }
        if self.entries.contains_key(&descriptor.resource_id) {
            return Err(ResourceError::Duplicate);
        }
        if self.uploads.len() >= MAX_UPLOAD_SESSIONS {
            return Err(ResourceError::BudgetExceeded);
        }
        let total = self
            .used
            .checked_add(bytes)
            .and_then(|v| v.checked_add(bytes))
            .ok_or(ResourceError::Overflow)?;
        let cpu = self.by_class[0]
            .checked_add(bytes)
            .ok_or(ResourceError::Overflow)?;
        let staging = self.by_class[2]
            .checked_add(bytes)
            .ok_or(ResourceError::Overflow)?;
        if total > self.limits.total_bytes
            || cpu > self.limits.cpu_bytes
            || staging > self.limits.staging_bytes
        {
            return Err(ResourceError::BudgetExceeded);
        }
        let sequence = self
            .next_upload
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let generation = self
            .generations
            .get(&descriptor.resource_id)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let mut buffer = Vec::new();
        buffer
            .try_reserve_exact(bytes as usize)
            .map_err(|_| ResourceError::BudgetExceeded)?;
        let status = UploadStatus {
            upload_id: format!("upload:{}:{}", self.identity, sequence),
            descriptor,
            received_bytes: 0,
        };
        self.generations
            .insert(status.descriptor.resource_id.clone(), generation);
        let last_used = self.bump_access();
        self.entries.insert(
            status.descriptor.resource_id.clone(),
            Entry {
                source: None,
                uploading: true,
                class: ResourceClass::Cpu,
                state: ResourceState::Loading,
                load_sequence: 0,
                data: None,
                mesh: None,
                texture: None,
                bytes,
                generation,
                leases: 0,
                last_used,
            },
        );
        self.uploads.insert(
            status.upload_id.clone(),
            UploadSession {
                owner: owner.into(),
                status: status.clone(),
                created_tick: tick,
                bytes: Arc::new(buffer),
            },
        );
        self.next_upload = sequence;
        self.revision = revision;
        self.used = total;
        self.by_class[0] = cpu;
        self.by_class[2] = staging;
        Ok(status)
    }
    fn upload(&self, owner: &str, upload_id: &str) -> Result<&UploadSession, ResourceError> {
        let session = self
            .uploads
            .get(upload_id)
            .ok_or(ResourceError::InvalidUpload)?;
        if session.owner != owner {
            return Err(ResourceError::PermissionDenied);
        }
        Ok(session)
    }
    pub fn upload_status(
        &self,
        owner: &str,
        upload_id: &str,
    ) -> Result<UploadStatus, ResourceError> {
        Ok(self.upload(owner, upload_id)?.status.clone())
    }
    pub fn append_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<UploadStatus, ResourceError> {
        let session = self.upload(owner, upload_id)?;
        let received = offset
            .checked_add(data.len() as u64)
            .ok_or(ResourceError::InvalidSize)?;
        if data.is_empty()
            || data.len() > MAX_UPLOAD_CHUNK_BYTES
            || offset != session.status.received_bytes
            || received > session.status.descriptor.total_bytes
        {
            return Err(ResourceError::InvalidSize);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let session = self.uploads.get_mut(upload_id).expect("validated upload");
        Arc::make_mut(&mut session.bytes).extend_from_slice(data);
        session.status.received_bytes = received;
        self.revision = revision;
        Ok(session.status.clone())
    }
    pub fn cancel_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
    ) -> Result<ResourceId, ResourceError> {
        self.upload(owner, upload_id)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let session = self.uploads.remove(upload_id).expect("validated upload");
        let d = session.status.descriptor;
        self.entries.remove(&d.resource_id);
        self.used -= d.total_bytes * 2;
        self.by_class[0] -= d.total_bytes;
        self.by_class[2] -= d.total_bytes;
        self.revision = revision;
        Ok(d.resource_id)
    }
    /// Cancel uploads whose host-stamped age reached `ttl`. Sessions without a
    /// stamp (tick 0) never expire here and still require explicit cancel/Stop.
    pub fn expire_uploads(&mut self, now: u64, ttl: u64) -> Vec<String> {
        if ttl == 0 {
            return Vec::new();
        }
        let expired: Vec<(String, String)> = self
            .uploads
            .iter()
            .filter(|(_, session)| {
                session.created_tick != 0 && now.saturating_sub(session.created_tick) >= ttl
            })
            .map(|(id, session)| (session.owner.clone(), id.clone()))
            .collect();
        let mut cancelled = Vec::new();
        for (owner, id) in expired {
            if self.cancel_upload(&owner, &id).is_ok() {
                cancelled.push(id);
            }
        }
        cancelled
    }
    pub fn finish_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
    ) -> Result<ResourceId, ResourceError> {
        let session = self.upload(owner, upload_id)?;
        if session.status.received_bytes != session.status.descriptor.total_bytes {
            return Err(ResourceError::InvalidSize);
        }
        self.revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let invalid = verify_digest(&session.status.descriptor.source, &session.bytes)
            .err()
            .or_else(|| {
                if matches!(session.status.descriptor.format, UploadFormat::Rgba8 { .. })
                    && session.bytes.as_chunks::<4>().0.iter().any(|p| p[3] != 255)
                {
                    Some(ResourceError::InvalidSize)
                } else {
                    None
                }
            });
        if let Some(error) = invalid {
            self.cancel_upload(owner, upload_id)?;
            return Err(error);
        }
        let decoded = match &session.status.descriptor.format {
            UploadFormat::EncodedImage { codec, color_space } => {
                match decode_encoded_image(&session.bytes, *codec, *color_space) {
                    Ok(texture) => Some(texture),
                    Err(error) => {
                        self.cancel_upload(owner, upload_id)?;
                        return Err(error);
                    }
                }
            }
            _ => None,
        };
        let encoded = session.status.descriptor.total_bytes;
        let decoded_bytes = decoded
            .as_ref()
            .map_or(encoded, |texture| texture.rgba8().len() as u64);
        let replaced_used = self
            .used
            .checked_sub(encoded)
            .and_then(|value| value.checked_sub(encoded))
            .and_then(|value| value.checked_add(decoded_bytes));
        let replaced_cpu = self.by_class[0]
            .checked_sub(encoded)
            .and_then(|value| value.checked_add(decoded_bytes));
        if replaced_used.is_none_or(|used| used > self.limits.total_bytes)
            || replaced_cpu.is_none_or(|cpu| cpu > self.limits.cpu_bytes)
        {
            self.cancel_upload(owner, upload_id)?;
            return Err(ResourceError::BudgetExceeded);
        }
        let session = self.uploads.remove(upload_id).expect("validated upload");
        let d = session.status.descriptor;
        let bytes = Arc::unwrap_or_clone(session.bytes);
        let entry = self
            .entries
            .get_mut(&d.resource_id)
            .expect("upload owns entry");
        match d.format {
            UploadFormat::Blob => entry.data = Some(bytes.into()),
            UploadFormat::Rgba8 {
                width,
                height,
                color_space,
            } => {
                entry.texture = Some(Arc::new(
                    TextureData::new(width, height, bytes, color_space).expect("validated texture"),
                ))
            }
            UploadFormat::EncodedImage { .. } => {
                entry.texture = Some(Arc::new(decoded.expect("decoded above")))
            }
        }
        entry.source = Some(d.source);
        entry.uploading = false;
        entry.state = ResourceState::Ready;
        self.used = self.used - encoded - encoded + decoded_bytes;
        self.by_class[0] = self.by_class[0] - encoded + decoded_bytes;
        self.by_class[2] -= encoded;
        self.revision += 1;
        Ok(d.resource_id)
    }
}

fn decode_encoded_image(
    bytes: &[u8],
    codec: ImageCodec,
    color_space: ColorSpace,
) -> Result<TextureData, ResourceError> {
    let matches_magic = match codec {
        ImageCodec::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        ImageCodec::Jpeg => bytes.starts_with(&[0xff, 0xd8]),
    };
    if !matches_magic {
        return Err(ResourceError::InvalidFormat);
    }
    let texture = spaceeyes_image_import::decode(bytes, color_space)
        .map_err(|_| ResourceError::InvalidFormat)?;
    if texture.width() > MAX_TEXTURE_DIMENSION || texture.height() > MAX_TEXTURE_DIMENSION {
        return Err(ResourceError::InvalidSize);
    }
    Ok(texture)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ResourceBudget;
    fn descriptor() -> UploadDescriptor {
        UploadDescriptor {
            resource_id: ResourceId::new("overflow").unwrap(),
            total_bytes: 1,
            source: UploadSource {
                source_id: "fixture".into(),
                source_version: "1".into(),
                sha256: Sha256::digest([1]).into(),
            },
            format: UploadFormat::Blob,
        }
    }
    #[test]
    fn begin_counter_overflows_do_not_publish_or_reserve() {
        for counter in 0..3 {
            let mut r = ResourceManager::new(ResourceBudget { max_bytes: 2 });
            match counter {
                0 => r.revision = u64::MAX,
                1 => r.next_upload = u64::MAX,
                _ => {
                    r.generations.insert(descriptor().resource_id, u64::MAX);
                }
            }
            let before = r.revision;
            assert_eq!(
                r.begin_upload("alice", descriptor()),
                Err(ResourceError::Overflow)
            );
            assert_eq!(r.used_bytes(), 0);
            assert_eq!(r.revision, before);
            assert!(r.uploads.is_empty());
            assert!(r.records().is_empty());
        }
    }
    #[test]
    fn append_finish_and_cancel_revision_overflow_preserves_session() {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 2 });
        let s = r.begin_upload("alice", descriptor()).unwrap();
        r.revision = u64::MAX;
        assert_eq!(
            r.append_upload("alice", &s.upload_id, 0, &[1]),
            Err(ResourceError::Overflow)
        );
        assert_eq!(r.upload_status("alice", &s.upload_id).unwrap(), s);
        r.revision = 0;
        let s = r.append_upload("alice", &s.upload_id, 0, &[1]).unwrap();
        r.revision = u64::MAX;
        assert_eq!(
            r.finish_upload("alice", &s.upload_id),
            Err(ResourceError::Overflow)
        );
        assert_eq!(
            r.cancel_upload("alice", &s.upload_id),
            Err(ResourceError::Overflow)
        );
        assert_eq!(r.upload_status("alice", &s.upload_id).unwrap(), s);
        assert_eq!(r.used_bytes(), 2);
        assert!(r.records().is_empty());
    }
}

#[cfg(test)]
mod encoded_image_tests {
    use super::*;
    use crate::ResourceBudget;
    use png::{BitDepth, ColorType, Encoder};
    use std::io::Cursor;

    fn png(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = Encoder::new(Cursor::new(&mut bytes), width, height);
            encoder.set_color(ColorType::Rgba);
            encoder.set_depth(BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let pixels: Vec<u8> = rgba
                .iter()
                .copied()
                .cycle()
                .take((width * height * 4) as usize)
                .collect();
            writer.write_image_data(&pixels).unwrap();
        }
        bytes
    }

    fn descriptor(bytes: &[u8], codec: ImageCodec) -> UploadDescriptor {
        UploadDescriptor {
            resource_id: ResourceId::new("image").unwrap(),
            total_bytes: bytes.len() as u64,
            source: UploadSource {
                source_id: "fixture".into(),
                source_version: "1".into(),
                sha256: upload_digest(bytes),
            },
            format: UploadFormat::EncodedImage {
                codec,
                color_space: ColorSpace::Srgb,
            },
        }
    }

    fn upload(r: &mut ResourceManager, bytes: &[u8], codec: ImageCodec) -> UploadStatus {
        let status = r.begin_upload("alice", descriptor(bytes, codec)).unwrap();
        r.append_upload("alice", &status.upload_id, 0, bytes)
            .unwrap()
    }

    #[test]
    fn png_upload_decodes_to_an_opaque_texture_with_core_authority() {
        let bytes = png(2, 1, [10, 20, 30, 255]);
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 4096 });
        let status = upload(&mut r, &bytes, ImageCodec::Png);
        let id = r.finish_upload("alice", &status.upload_id).unwrap();
        assert_eq!(r.state(&id), Some(ResourceState::Ready));
        assert_eq!(r.used_bytes(), 8, "decoded bytes replace staging");
        let lease = r.lease(&id).unwrap();
        let texture = r.read_texture(&lease).unwrap();
        assert_eq!((texture.width(), texture.height()), (2, 1));
        assert_eq!(texture.rgba8(), &[10, 20, 30, 255, 10, 20, 30, 255]);
        assert_eq!(texture.color_space(), ColorSpace::Srgb);
    }

    #[test]
    fn declared_codec_must_match_the_actual_stream() {
        let bytes = png(1, 1, [1, 2, 3, 255]);
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 4096 });
        let status = upload(&mut r, &bytes, ImageCodec::Jpeg);
        assert_eq!(
            r.finish_upload("alice", &status.upload_id),
            Err(ResourceError::InvalidFormat)
        );
        assert_eq!(
            r.upload_status("alice", &status.upload_id),
            Err(ResourceError::InvalidUpload)
        );
        assert_eq!(r.used_bytes(), 0, "failed decode releases the reservation");
    }

    #[test]
    fn decoded_size_must_fit_the_budget_not_only_the_encoded_size() {
        let bytes = png(500, 500, [9, 9, 9, 255]);
        let budget = bytes.len() as u64 + 4096;
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: budget });
        let status = upload(&mut r, &bytes, ImageCodec::Png);
        assert_eq!(
            r.finish_upload("alice", &status.upload_id),
            Err(ResourceError::BudgetExceeded)
        );
        assert_eq!(r.used_bytes(), 0);
    }

    #[test]
    fn encoded_uploads_are_bounded_by_the_encoded_limit() {
        let bytes = png(1, 1, [0, 0, 0, 255]);
        let mut descriptor = descriptor(&bytes, ImageCodec::Png);
        descriptor.total_bytes = MAX_ENCODED_IMAGE_BYTES as u64 + 1;
        let mut r = ResourceManager::new(ResourceBudget {
            max_bytes: MAX_ENCODED_IMAGE_BYTES as u64 * 2,
        });
        assert_eq!(
            r.begin_upload("alice", descriptor),
            Err(ResourceError::InvalidSize)
        );
    }
}
