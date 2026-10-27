// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use sha2::{Digest, Sha256};
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{ColorSpace, MAX_TEXTURE_DIMENSION};
use spaceeyes_resources::{
    ResourceBudget, ResourceError, ResourceManager, ResourceState, UploadDescriptor, UploadFormat,
    UploadSource,
};

fn descriptor(name: &str) -> UploadDescriptor {
    UploadDescriptor {
        resource_id: ResourceId::new(name).unwrap(),
        total_bytes: 3,
        source: UploadSource {
            source_id: "fixture".into(),
            source_version: "1".into(),
            sha256: [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad,
            ],
        },
        format: UploadFormat::Blob,
    }
}
#[test]
fn upload_publishes_only_after_verified_finish_and_restores_source() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 6 });
    let d = descriptor("asset");
    let s = r.begin_upload("alice", d.clone()).unwrap();
    assert_eq!(r.used_bytes(), 6);
    assert_eq!(r.usage().cpu_bytes, 3);
    assert_eq!(r.usage().staging_bytes, 3);
    assert_eq!(r.state(&d.resource_id), Some(ResourceState::Loading));
    assert!(r.records().is_empty());
    assert_eq!(r.lease(&d.resource_id), Err(ResourceError::NotReady));
    r.append_upload("alice", &s.upload_id, 0, b"a").unwrap();
    assert_eq!(
        r.finish_upload("alice", &s.upload_id),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(
        r.upload_status("alice", &s.upload_id)
            .unwrap()
            .received_bytes,
        1
    );
    r.append_upload("alice", &s.upload_id, 1, b"bc").unwrap();
    assert_eq!(
        r.finish_upload("alice", &s.upload_id).unwrap(),
        d.resource_id
    );
    assert_eq!(r.used_bytes(), 3);
    assert_eq!(r.usage().staging_bytes, 0);
    let records = r.records();
    assert_eq!(records[0].source, Some(d.source));
    let mut restored = ResourceManager::restore(ResourceBudget { max_bytes: 6 }, &records).unwrap();
    let lease = restored.lease(&d.resource_id).unwrap();
    assert_eq!(restored.read(&lease).unwrap(), b"abc");
    let mut corrupted = records;
    corrupted[0].data.as_mut().unwrap()[0] = 0;
    assert!(matches!(
        ResourceManager::restore(ResourceBudget { max_bytes: 6 }, &corrupted),
        Err(ResourceError::DigestMismatch)
    ));
}
#[test]
fn upload_rejections_and_cancellation_are_atomic_and_tokens_are_scoped() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 6 });
    let s = r.begin_upload("alice", descriptor("asset")).unwrap();
    let revision = r.revision();
    assert_eq!(
        r.append_upload("bob", &s.upload_id, 0, b"a"),
        Err(ResourceError::PermissionDenied)
    );
    assert_eq!(
        r.cancel_upload("bob", &s.upload_id),
        Err(ResourceError::PermissionDenied)
    );
    assert_eq!(
        r.append_upload("alice", &s.upload_id, 1, b"a"),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(
        r.append_upload("alice", &s.upload_id, 0, b""),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(
        r.append_upload("alice", &s.upload_id, 0, b"abcd"),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(r.revision(), revision);
    assert_eq!(r.upload_status("alice", &s.upload_id).unwrap(), s);
    let mut other = ResourceManager::new(ResourceBudget { max_bytes: 6 });
    assert_eq!(
        other.cancel_upload("alice", &s.upload_id),
        Err(ResourceError::InvalidUpload)
    );
    r.cancel_upload("alice", &s.upload_id).unwrap();
    assert_eq!(r.used_bytes(), 0);
    assert_eq!(
        r.append_upload("alice", &s.upload_id, 0, b"abc"),
        Err(ResourceError::InvalidUpload)
    );
    let next = r.begin_upload("alice", descriptor("asset")).unwrap();
    assert_ne!(next.upload_id, s.upload_id);
    r.clear();
    assert_eq!(r.used_bytes(), 0);
    assert_eq!(
        r.finish_upload("alice", &next.upload_id),
        Err(ResourceError::InvalidUpload)
    );
}
#[test]
fn digest_failure_cancels_both_reservations() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 6 });
    let s = r.begin_upload("alice", descriptor("asset")).unwrap();
    r.append_upload("alice", &s.upload_id, 0, b"abd").unwrap();
    assert_eq!(
        r.finish_upload("alice", &s.upload_id),
        Err(ResourceError::DigestMismatch)
    );
    assert_eq!(r.used_bytes(), 0);
    assert!(r.records().is_empty());
    assert_eq!(r.state(&s.descriptor.resource_id), None);
}

#[test]
fn cpu_staging_and_total_budget_failures_reserve_nothing() {
    use spaceeyes_resources::ResourceLimits;
    for limits in [
        ResourceLimits {
            total_bytes: 6,
            cpu_bytes: 2,
            gpu_bytes: 0,
            staging_bytes: 3,
        },
        ResourceLimits {
            total_bytes: 6,
            cpu_bytes: 3,
            gpu_bytes: 0,
            staging_bytes: 2,
        },
        ResourceLimits {
            total_bytes: 5,
            cpu_bytes: 3,
            gpu_bytes: 0,
            staging_bytes: 3,
        },
    ] {
        let mut r = ResourceManager::with_limits(limits);
        let before = r.usage();
        assert_eq!(
            r.begin_upload("alice", descriptor("asset")),
            Err(ResourceError::BudgetExceeded)
        );
        assert_eq!(r.usage(), before);
        assert_eq!(r.revision(), 0);
        assert_eq!(r.state(&ResourceId::new("asset").unwrap()), None);
    }
}
#[test]
fn four_sessions_and_descriptor_bounds_are_enforced() {
    use spaceeyes_resources::{MAX_SOURCE_ID_BYTES, MAX_SOURCE_VERSION_BYTES, MAX_UPLOAD_BYTES};
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 100 });
    let mut bad = descriptor("bad");
    for size in [0, MAX_UPLOAD_BYTES + 1] {
        bad.total_bytes = size;
        assert_eq!(
            r.begin_upload("alice", bad.clone()),
            Err(ResourceError::InvalidSize)
        );
    }
    bad.total_bytes = 3;
    for (name, version) in [
        (String::new(), "1".into()),
        ("x".repeat(MAX_SOURCE_ID_BYTES + 1), "1".into()),
        ("x".into(), String::new()),
        ("x".into(), "1".repeat(MAX_SOURCE_VERSION_BYTES + 1)),
    ] {
        bad.source.source_id = name;
        bad.source.source_version = version;
        assert_eq!(
            r.begin_upload("alice", bad.clone()),
            Err(ResourceError::InvalidSize)
        );
    }
    let sessions: Vec<_> = (0..4)
        .map(|i| {
            r.begin_upload("alice", descriptor(&format!("asset{i}")))
                .unwrap()
        })
        .collect();
    let before = r.usage();
    let revision = r.revision();
    assert_eq!(
        r.begin_upload("alice", descriptor("fifth")),
        Err(ResourceError::BudgetExceeded)
    );
    assert_eq!(r.usage(), before);
    assert_eq!(r.revision(), revision);
    r.cancel_upload("alice", &sessions[0].upload_id).unwrap();
    r.begin_upload("alice", descriptor("fifth")).unwrap();
}
#[test]
fn chunk_limit_duplicate_offsets_and_exact_resource_limit() {
    use spaceeyes_resources::{MAX_UPLOAD_BYTES, MAX_UPLOAD_CHUNK_BYTES};
    let bytes = vec![5; MAX_UPLOAD_BYTES as usize];
    let mut d = descriptor("maximum");
    d.total_bytes = MAX_UPLOAD_BYTES;
    d.source.sha256 = Sha256::digest(&bytes).into();
    let mut r = ResourceManager::new(ResourceBudget {
        max_bytes: MAX_UPLOAD_BYTES * 2,
    });
    let s = r.begin_upload("alice", d).unwrap();
    assert_eq!(
        r.append_upload(
            "alice",
            &s.upload_id,
            0,
            &bytes[..MAX_UPLOAD_CHUNK_BYTES + 1]
        ),
        Err(ResourceError::InvalidSize)
    );
    for (i, chunk) in bytes.chunks(MAX_UPLOAD_CHUNK_BYTES).enumerate() {
        r.append_upload(
            "alice",
            &s.upload_id,
            (i * MAX_UPLOAD_CHUNK_BYTES) as u64,
            chunk,
        )
        .unwrap();
        if i == 0 {
            assert_eq!(
                r.append_upload("alice", &s.upload_id, 0, chunk),
                Err(ResourceError::InvalidSize)
            );
        }
    }
    r.finish_upload("alice", &s.upload_id).unwrap();
    assert_eq!(r.used_bytes(), MAX_UPLOAD_BYTES);
}
#[test]
fn rgba8_upload_restores_typed_texture_and_rejects_transparency() {
    for color_space in [ColorSpace::Linear, ColorSpace::Srgb] {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 16 });
        let mut d = descriptor("texture");
        d.total_bytes = 8;
        d.format = UploadFormat::Rgba8 {
            width: 2,
            height: 1,
            color_space,
        };
        let pixels = [0, 128, 255, 255, 255, 0, 8, 255];
        d.source.sha256 = Sha256::digest(pixels).into();
        let s = r.begin_upload("alice", d.clone()).unwrap();
        // Chunks need not end on a texel boundary.
        r.append_upload("alice", &s.upload_id, 0, &pixels[..3])
            .unwrap();
        r.append_upload("alice", &s.upload_id, 3, &pixels[3..])
            .unwrap();
        r.finish_upload("alice", &s.upload_id).unwrap();
        let mut restored =
            ResourceManager::restore(ResourceBudget { max_bytes: 16 }, &r.records()).unwrap();
        let lease = restored.lease(&d.resource_id).unwrap();
        let texture = restored.read_texture(&lease).unwrap();
        assert_eq!(texture.rgba8(), &pixels);
        assert_eq!(texture.width(), 2);
        assert_eq!(texture.color_space(), color_space);
        let mut corrupted = r.records();
        corrupted[0].source.as_mut().unwrap().sha256[0] ^= 1;
        assert!(matches!(
            ResourceManager::restore(ResourceBudget { max_bytes: 16 }, &corrupted),
            Err(ResourceError::DigestMismatch)
        ));
        r.unregister(&d.resource_id).unwrap();
        let pixels = [0, 128, 255, 254, 255, 0, 8, 255];
        d.source.sha256 = Sha256::digest(pixels).into();
        let s = r.begin_upload("alice", d).unwrap();
        r.append_upload("alice", &s.upload_id, 0, &pixels).unwrap();
        assert_eq!(
            r.finish_upload("alice", &s.upload_id),
            Err(ResourceError::InvalidSize)
        );
        assert_eq!(r.used_bytes(), 0);
    }
}
#[test]
fn invalid_texture_shape_rejected_before_reservation() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 100 });
    for (width, height, total) in [
        (0, 1, 4),
        (1, 0, 4),
        (MAX_TEXTURE_DIMENSION + 1, 1, 4),
        (1, 1, 3),
    ] {
        let mut d = descriptor("texture");
        d.total_bytes = total;
        d.format = UploadFormat::Rgba8 {
            width,
            height,
            color_space: ColorSpace::Srgb,
        };
        assert_eq!(r.begin_upload("alice", d), Err(ResourceError::InvalidSize));
        assert_eq!(r.used_bytes(), 0);
    }
}
