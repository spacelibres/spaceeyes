// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{ResourceLimits, ResourceManager, ResourceState};

fn id(value: &str) -> ResourceId {
    ResourceId::new(value).unwrap()
}

fn limits() -> ResourceLimits {
    ResourceLimits {
        total_bytes: 1024,
        cpu_bytes: 1024,
        gpu_bytes: 1024,
        staging_bytes: 1024,
    }
}

fn ready(manager: &mut ResourceManager, value: &str, bytes: usize) -> ResourceId {
    let resource = id(value);
    manager.declare(resource.clone(), bytes as u64).unwrap();
    let token = manager.begin_load(&resource).unwrap();
    manager.complete_load(&token, vec![0; bytes]).unwrap();
    resource
}

#[test]
fn evicts_only_ready_unleased_cpu_assets_in_lru_order() {
    let mut manager = ResourceManager::with_limits(limits());
    let first = ready(&mut manager, "first", 10);
    let second = ready(&mut manager, "second", 10);
    let third = ready(&mut manager, "third", 10);
    let declared = id("declared");
    manager.declare(declared.clone(), 5).unwrap();
    let loading = id("loading");
    manager.declare(loading.clone(), 5).unwrap();
    manager.begin_load(&loading).unwrap();
    let lease = manager.lease(&first).unwrap();

    let evicted = manager.evict_lru(10);
    assert_eq!(evicted, vec![second.clone()]);
    assert_eq!(manager.used_bytes(), 30);
    assert_eq!(manager.state(&second), None);
    assert_eq!(manager.state(&declared), Some(ResourceState::Declared));
    assert_eq!(manager.state(&loading), Some(ResourceState::Loading));
    assert_eq!(manager.state(&first), Some(ResourceState::Ready));

    manager.release_lease(&lease).unwrap();
    let evicted = manager.evict_lru(100);
    assert_eq!(evicted, vec![third, first]);
    assert_eq!(manager.used_bytes(), 10);
}

#[test]
fn zero_target_and_revision_are_atomic() {
    let mut manager = ResourceManager::with_limits(limits());
    let resource = ready(&mut manager, "asset", 8);
    let before = manager.revision();
    assert!(manager.evict_lru(0).is_empty());
    assert_eq!(manager.revision(), before);
    assert_eq!(manager.evict_lru(8), vec![resource]);
    assert_eq!(manager.revision(), before + 1);
    assert_eq!(manager.used_bytes(), 0);
    assert!(manager.evict_lru(8).is_empty());
}
