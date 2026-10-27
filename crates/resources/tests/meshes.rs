// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{TriangleMesh, Vertex};
use spaceeyes_resources::{ResourceBudget, ResourceError, ResourceManager};
fn mesh() -> TriangleMesh {
    TriangleMesh::new(
        vec![
            Vertex::new([-1.0, -1.0, 0.0], [0.0, 0.0, 1.0]).unwrap(),
            Vertex::new([1.0, -1.0, 0.0], [0.0, 0.0, 1.0]).unwrap(),
            Vertex::new([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]).unwrap(),
        ],
        vec![0, 1, 2],
    )
    .unwrap()
}
#[test]
fn mesh_registration_leases_restore_and_budget_are_consistent() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 200 });
    let id = ResourceId::new("triangle").unwrap();
    r.register_mesh(id.clone(), mesh()).unwrap();
    assert_eq!(r.used_bytes(), 156);
    let first = r.lease(&id).unwrap();
    let second = r.lease(&id).unwrap();
    let snapshot = r.read_mesh(&first).unwrap();
    assert_eq!(
        r.register_mesh(ResourceId::new("over-budget").unwrap(), mesh()),
        Err(ResourceError::BudgetExceeded)
    );
    assert_eq!(r.used_bytes(), 156);
    let records = r.records();
    let mut restored =
        ResourceManager::restore(ResourceBudget { max_bytes: 200 }, &records).unwrap();
    assert!(restored.mesh_available(&id));
    assert_eq!(restored.read_mesh(&first), Err(ResourceError::InvalidLease));
    let token = restored.lease(&id).unwrap();
    assert_eq!(*restored.read_mesh(&token).unwrap(), mesh());
    r.release_lease(&first).unwrap();
    assert_eq!(r.unregister(&id), Err(ResourceError::StillLeased));
    r.release_lease(&second).unwrap();
    r.unregister(&id).unwrap();
    assert_eq!(r.used_bytes(), 0);
    assert_eq!(snapshot.indices(), &[0, 1, 2]);
    let mut corrupt = records;
    corrupt[0].bytes = 1;
    assert!(matches!(
        ResourceManager::restore(ResourceBudget { max_bytes: 200 }, &corrupt),
        Err(ResourceError::InvalidSize)
    ));
}
