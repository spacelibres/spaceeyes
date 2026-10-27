use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{ResourceBudget, ResourceError, ResourceManager, ResourceState};
fn id() -> ResourceId {
    ResourceId::new("bytes").unwrap()
}
#[test]
fn cancellation_retry_and_reregistration_reject_late_bytes() {
    let mut r = ResourceManager::new(ResourceBudget { max_bytes: 3 });
    r.declare(id(), 3).unwrap();
    assert_eq!(r.lease(&id()), Err(ResourceError::NotReady));
    let old = r.begin_load(&id()).unwrap();
    r.cancel_load(&old).unwrap();
    let next = r.begin_load(&id()).unwrap();
    assert_eq!(
        r.complete_load(&old, vec![1, 2, 3]),
        Err(ResourceError::StaleLoad)
    );
    assert_eq!(
        r.complete_load(&next, vec![1]),
        Err(ResourceError::InvalidSize)
    );
    assert_eq!(r.state(&id()), Some(ResourceState::Loading));
    r.complete_load(&next, vec![1, 2, 3]).unwrap();
    let lease = r.lease(&id()).unwrap();
    assert_eq!(r.read(&lease).unwrap(), &[1, 2, 3]);
    r.release_lease(&lease).unwrap();
    assert_eq!(r.read(&lease), Err(ResourceError::InvalidLease));
    r.unregister(&id()).unwrap();
    r.declare(id(), 3).unwrap();
    let current = r.begin_load(&id()).unwrap();
    assert_eq!(
        r.complete_load(&next, vec![1, 2, 3]),
        Err(ResourceError::StaleLoad)
    );
    r.fail_load(&current).unwrap();
    assert_eq!(r.state(&id()), Some(ResourceState::Failed));
}
#[test]
fn tokens_cannot_cross_managers_and_clear_invalidates_leases() {
    let mut a = ResourceManager::new(ResourceBudget { max_bytes: 3 });
    let mut b = ResourceManager::new(ResourceBudget { max_bytes: 3 });
    a.register(id(), 3).unwrap();
    b.register(id(), 3).unwrap();
    let token = a.lease(&id()).unwrap();
    assert_eq!(b.release_lease(&token), Err(ResourceError::InvalidLease));
    a.clear();
    a.register(id(), 3).unwrap();
    assert_eq!(a.release_lease(&token), Err(ResourceError::InvalidLease));
    a.clear();
    b.clear();
    a.declare(id(), 3).unwrap();
    b.declare(id(), 3).unwrap();
    let load = a.begin_load(&id()).unwrap();
    b.begin_load(&id()).unwrap();
    assert_eq!(
        b.complete_load(&load, vec![0; 3]),
        Err(ResourceError::StaleLoad)
    );
}
