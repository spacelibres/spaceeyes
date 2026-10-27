// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{ColorSpace, TextureData};
use spaceeyes_resources::{ResourceBudget, ResourceError, ResourceManager};
#[test]
fn texture_assets_keep_typed_leases_budget_and_restore_consistent() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 8 });
    let id = ResourceId::new("texture").unwrap();
    let data = TextureData::new(2, 1, vec![255; 8], ColorSpace::Linear).unwrap();
    r.register_texture(id.clone(), data.clone()).unwrap();
    assert_eq!(r.used_bytes(), 8);
    assert!(r.texture_available(&id));
    assert!(!r.mesh_available(&id));
    let lease = r.lease(&id).unwrap();
    assert_eq!(*r.read_texture(&lease).unwrap(), data);
    assert_eq!(r.read_mesh(&lease), Err(ResourceError::NotReady));
    assert_eq!(r.unregister(&id), Err(ResourceError::StillLeased));
    let records = r.records();
    let restored = ResourceManager::restore(ResourceBudget { max_bytes: 8 }, &records).unwrap();
    assert!(restored.texture_available(&id));
    assert_eq!(
        r.register_texture(
            ResourceId::new("over").unwrap(),
            TextureData::new(1, 1, vec![255; 4], ColorSpace::Linear).unwrap()
        ),
        Err(ResourceError::BudgetExceeded)
    );
    r.release_lease(&lease).unwrap();
    assert_eq!(r.read_texture(&lease), Err(ResourceError::InvalidLease));
    r.unregister(&id).unwrap();
    assert_eq!(r.used_bytes(), 0);
    let mut corrupt = records;
    corrupt[0].data = Some(vec![0; 8]);
    assert!(matches!(
        ResourceManager::restore(ResourceBudget { max_bytes: 16 }, &corrupt),
        Err(ResourceError::InvalidState)
    ));
}
