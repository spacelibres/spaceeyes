// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C09: bounded disk source loading with traversal, size, and digest checks.
#![cfg(not(target_arch = "wasm32"))]
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{
    upload_digest, DiskSource, ResourceBudget, ResourceError, ResourceManager, UploadSource,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn scratch() -> PathBuf {
    let unique = format!(
        "spaceeyes-disk-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let path = std::env::temp_dir().join(unique);
    fs::create_dir_all(&path).unwrap();
    path
}

fn source(bytes: &[u8]) -> UploadSource {
    UploadSource {
        source_id: "fixture".into(),
        source_version: "1".into(),
        sha256: upload_digest(bytes),
    }
}

fn fixture(root: &Path) -> Vec<u8> {
    let bytes = b"bounded disk payload".to_vec();
    fs::create_dir_all(root.join("assets")).unwrap();
    fs::write(root.join("assets/body.bin"), &bytes).unwrap();
    bytes
}

#[test]
fn reads_only_inside_roots_and_verifies_the_declared_digest() {
    let root = scratch();
    let bytes = fixture(&root);
    let source = source(&bytes);
    let disk = DiskSource::new([root.clone()], 1024).unwrap();
    assert_eq!(disk.read("assets/body.bin", &source).unwrap(), bytes);
    assert_eq!(
        disk.read("assets/missing.bin", &source),
        Err(ResourceError::NotFound)
    );
    let mut wrong = source.clone();
    wrong.sha256[0] ^= 0xff;
    assert_eq!(
        disk.read("assets/body.bin", &wrong),
        Err(ResourceError::DigestMismatch)
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn traversal_absolute_paths_and_oversized_files_are_rejected() {
    let root = scratch();
    let bytes = fixture(&root);
    fs::write(root.parent().unwrap().join("outside.bin"), &bytes).unwrap();
    let source = source(&bytes);
    let disk = DiskSource::new([root.clone()], 1024).unwrap();
    for path in ["../outside.bin", "assets/../../outside.bin", "/etc/passwd"] {
        assert_eq!(
            disk.read(path, &source),
            Err(ResourceError::PermissionDenied),
            "{path}"
        );
    }
    assert_eq!(disk.read("", &source), Err(ResourceError::PermissionDenied));
    let tight = DiskSource::new([root.clone()], 4).unwrap();
    assert_eq!(
        tight.read("assets/body.bin", &source),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(
        DiskSource::new([], 1024).unwrap_err(),
        ResourceError::NotFound
    );
    assert_eq!(
        DiskSource::new([root.clone()], 0).unwrap_err(),
        ResourceError::InvalidSize
    );
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_file(root.parent().unwrap().join("outside.bin"));
}

#[test]
fn open_upload_publishes_only_after_verification() {
    let root = scratch();
    let bytes = fixture(&root);
    let disk = DiskSource::new([root.clone()], 1024).unwrap();
    let mut manager = ResourceManager::new(ResourceBudget { max_bytes: 1024 });
    let id = ResourceId::new("disk-asset").unwrap();
    let published = disk
        .open_upload(
            &mut manager,
            "host",
            id.clone(),
            "assets/body.bin",
            source(&bytes),
        )
        .unwrap();
    assert_eq!(published, id);
    assert_eq!(manager.used_bytes(), bytes.len() as u64);
    let lease = manager.lease(&id).unwrap();
    assert_eq!(manager.read(&lease).unwrap(), bytes);

    let mut wrong = source(&bytes);
    wrong.sha256[0] ^= 0xff;
    let tampered_id = ResourceId::new("tampered").unwrap();
    assert_eq!(
        disk.open_upload(
            &mut manager,
            "host",
            tampered_id.clone(),
            "assets/body.bin",
            wrong
        ),
        Err(ResourceError::DigestMismatch)
    );
    assert_eq!(manager.state(&tampered_id), None);
    assert_eq!(
        manager.used_bytes(),
        bytes.len() as u64,
        "failed verification reserves nothing"
    );
    let _ = fs::remove_dir_all(root);
}
