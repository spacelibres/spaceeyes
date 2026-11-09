use spaceeyes_core::{Core, CoreError, CoreLimits};

#[test]
fn bounded_lifecycle_rejects_growth_without_overwriting_existing_state() {
    let mut core = Core::with_limits(CoreLimits {
        active_sessions: 1,
        session_history: 2,
        objects: 1,
    });
    core.open_session("a", "one.plugin", true).unwrap();
    assert_eq!(
        core.open_session("b", "two.plugin", true),
        Err(CoreError::CapacityExceeded)
    );
    core.register_object("a", "body:one").unwrap();
    assert_eq!(
        core.register_object("a", "body:two"),
        Err(CoreError::CapacityExceeded)
    );
    core.release_session("a");
    core.open_session("b", "two.plugin", true).unwrap();
    core.register_object("b", "body:two").unwrap();
    core.release_session("b");
    assert_eq!(
        core.open_session("c", "three.plugin", true),
        Err(CoreError::CapacityExceeded)
    );
    assert_eq!(
        core.open_session("a", "one.plugin", true),
        Err(CoreError::DuplicateSession)
    );
}
