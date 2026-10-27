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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UploadFormat {
    Blob,
    Rgba8 {
        width: u32,
        height: u32,
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
            },
        );
        self.uploads.insert(
            status.upload_id.clone(),
            UploadSession {
                owner: owner.into(),
                status: status.clone(),
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
        }
        entry.source = Some(d.source);
        entry.uploading = false;
        entry.state = ResourceState::Ready;
        self.used -= d.total_bytes;
        self.by_class[2] -= d.total_bytes;
        self.revision += 1;
        Ok(d.resource_id)
    }
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
