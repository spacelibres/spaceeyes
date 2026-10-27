// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded disk source loader for trusted native hosts.
//!
//! The core never reads arbitrary paths: every read is confined to canonicalized
//! roots, rejects absolute or parent traversal, caps bytes, and verifies the
//! declared SHA-256 before publishing anything. This is not a network loader and
//! does not grant plugin filesystem access.
use crate::{upload_digest, UploadSource};
use crate::{ResourceError, ResourceId, ResourceManager, MAX_UPLOAD_BYTES};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug)]
pub struct DiskSource {
    roots: Vec<PathBuf>,
    max_bytes: u64,
}

impl DiskSource {
    /// Canonicalize existing roots once; later reads cannot escape them.
    pub fn new(
        roots: impl IntoIterator<Item = PathBuf>,
        max_bytes: u64,
    ) -> Result<Self, ResourceError> {
        if max_bytes == 0 || max_bytes > MAX_UPLOAD_BYTES {
            return Err(ResourceError::InvalidSize);
        }
        let mut canonical = Vec::new();
        for root in roots {
            let root = root.canonicalize().map_err(|_| ResourceError::NotFound)?;
            if !root.is_dir() {
                return Err(ResourceError::NotFound);
            }
            canonical.push(root);
        }
        if canonical.is_empty() {
            return Err(ResourceError::NotFound);
        }
        Ok(Self {
            roots: canonical,
            max_bytes,
        })
    }

    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// Read a relative file inside an allowed root and verify the declared digest.
    pub fn read(&self, relative: &str, source: &UploadSource) -> Result<Vec<u8>, ResourceError> {
        source.validate()?;
        let relative = validate_relative(relative)?;
        let mut selected: Option<(PathBuf, u64)> = None;
        for root in &self.roots {
            let candidate = root.join(&relative);
            let Ok(canonical) = candidate.canonicalize() else {
                continue;
            };
            // Symlinks may not escape the root even when the requested path looks safe.
            if !canonical.starts_with(root) || !canonical.is_file() {
                continue;
            }
            let length = canonical
                .metadata()
                .map_err(|_| ResourceError::NotFound)?
                .len();
            if length == 0 || length > self.max_bytes {
                return Err(ResourceError::InvalidSize);
            }
            selected = Some((canonical, length));
            break;
        }
        let (path, length) = selected.ok_or(ResourceError::NotFound)?;
        let bytes = std::fs::read(&path).map_err(|_| ResourceError::NotFound)?;
        if bytes.len() as u64 != length {
            return Err(ResourceError::InvalidSize);
        }
        if upload_digest(&bytes) != source.sha256 {
            return Err(ResourceError::DigestMismatch);
        }
        Ok(bytes)
    }

    /// Read, verify, and publish one file through the ordinary bounded upload path.
    pub fn open_upload(
        &self,
        manager: &mut ResourceManager,
        owner: &str,
        resource_id: ResourceId,
        relative: &str,
        source: UploadSource,
    ) -> Result<ResourceId, ResourceError> {
        let bytes = self.read(relative, &source)?;
        let upload = manager.begin_upload(
            owner,
            crate::UploadDescriptor {
                resource_id,
                total_bytes: bytes.len() as u64,
                source,
                format: crate::UploadFormat::Blob,
            },
        )?;
        manager.append_upload(owner, &upload.upload_id, 0, &bytes)?;
        manager.finish_upload(owner, &upload.upload_id)
    }
}

fn validate_relative(relative: &str) -> Result<PathBuf, ResourceError> {
    if relative.trim().is_empty() || relative.len() > 256 || relative.contains('\0') {
        return Err(ResourceError::PermissionDenied);
    }
    let path = Path::new(relative);
    if path.is_absolute() {
        return Err(ResourceError::PermissionDenied);
    }
    let mut safe = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => safe.push(part),
            _ => return Err(ResourceError::PermissionDenied),
        }
    }
    if safe.as_os_str().is_empty() {
        return Err(ResourceError::PermissionDenied);
    }
    Ok(safe)
}
