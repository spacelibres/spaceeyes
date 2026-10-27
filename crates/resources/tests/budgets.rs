// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{ResourceClass, ResourceError, ResourceLimits, ResourceManager};

fn id(value: &str) -> ResourceId {
    ResourceId::new(value).unwrap()
}
fn limits() -> ResourceLimits {
    ResourceLimits {
        total_bytes: 100,
        cpu_bytes: 60,
        gpu_bytes: 50,
        staging_bytes: 20,
    }
}

#[test]
fn independent_and_total_ceilings_reject_atomically() {
    let mut r = ResourceManager::with_limits(limits());
    r.register(id("asset"), 50).unwrap();
    assert_eq!(r.class(&id("asset")), Some(ResourceClass::Cpu));
    let before = r.usage();
    let revision = r.revision();
    assert_eq!(
        r.register(id("extra"), 11),
        Err(ResourceError::BudgetExceeded)
    );
    assert_eq!(r.usage(), before);
    assert_eq!(r.revision(), revision);
    r.register_gpu(id("surface"), 40).unwrap();
    assert_eq!(
        r.register_staging(id("upload"), 11),
        Err(ResourceError::BudgetExceeded)
    );
    r.register_staging(id("upload"), 10).unwrap();
    assert_eq!(r.usage().total_bytes, 100);
    assert_eq!(r.usage().cpu_bytes, 50);
    assert_eq!(r.usage().gpu_bytes, 40);
    assert_eq!(r.usage().staging_bytes, 10);
    r.unregister(&id("surface")).unwrap();
    assert_eq!(r.usage().gpu_bytes, 0);
    assert_eq!(
        r.register_staging(id("overflow"), 11),
        Err(ResourceError::BudgetExceeded)
    );
    assert_eq!(r.usage().total_bytes, 60);
}

#[test]
fn frame_reservations_are_atomic_leased_and_generation_safe() {
    let mut r = ResourceManager::with_limits(limits());
    r.register(id("asset"), 10).unwrap();
    let revision = r.revision();
    assert!(r.reserve_frame(id("gpu"), 40, id("stage"), 21).is_err());
    assert_eq!(r.revision(), revision);
    assert_eq!(r.usage().total_bytes, 10);
    let token = r.reserve_frame(id("gpu"), 40, id("stage"), 20).unwrap();
    assert_eq!(r.unregister(&id("gpu")), Err(ResourceError::StillLeased));
    assert_eq!(r.usage().total_bytes, 70);
    let extra = r.lease(&id("stage")).unwrap();
    let before = r.usage();
    let revision = r.revision();
    assert_eq!(r.release_frame(&token), Err(ResourceError::StillLeased));
    assert_eq!(r.usage(), before);
    assert_eq!(r.revision(), revision);
    r.release_lease(&extra).unwrap();
    r.release_frame(&token).unwrap();
    assert_eq!(r.usage().total_bytes, 10);
    let next = r.reserve_frame(id("gpu"), 40, id("stage"), 20).unwrap();
    let before = r.usage();
    assert_eq!(r.release_frame(&token), Err(ResourceError::InvalidLease));
    assert_eq!(r.usage(), before);
    r.clear();
    assert_eq!(r.usage().total_bytes, 0);
    assert_eq!(r.release_frame(&next), Err(ResourceError::InvalidLease));
}

#[test]
fn project_records_exclude_runtime_resources_and_restore_uses_target_limits() {
    let mut r = ResourceManager::with_limits(limits());
    r.register(id("asset"), 40).unwrap();
    r.register_gpu(id("surface"), 30).unwrap();
    r.register_staging(id("decode"), 10).unwrap();
    let records = r.records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].class, ResourceClass::Cpu);
    let restored = ResourceManager::restore_with_limits(limits(), &records).unwrap();
    assert_eq!(restored.usage().total_bytes, 40);
    assert_eq!(restored.usage().gpu_bytes, 0);
    let mut forged = records.clone();
    forged[0].class = ResourceClass::Gpu;
    assert!(matches!(
        ResourceManager::restore_with_limits(limits(), &forged),
        Err(ResourceError::InvalidState)
    ));
    let mut smaller = limits();
    smaller.cpu_bytes = 39;
    assert!(matches!(
        ResourceManager::restore_with_limits(smaller, &records),
        Err(ResourceError::BudgetExceeded)
    ));
}
