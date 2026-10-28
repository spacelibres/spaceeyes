use spaceeyes_core::{Core, CoreError};

#[test]
fn core_validates_session_permission_and_target_before_focus() {
    let mut core = Core::default();
    core.open_session("session-a", "example.camera", true)
        .unwrap();
    assert_eq!(
        core.focus("session-a", "example.camera", "body:mars"),
        Err(CoreError::UnknownObject)
    );
    core.register_object("session-a", "body:mars").unwrap();
    core.focus("session-a", "example.camera", "body:mars")
        .unwrap();
    assert_eq!(core.focused_object(), Some("body:mars"));
    assert_eq!(
        core.focus("session-a", "other.plugin", "body:mars"),
        Err(CoreError::WrongOwner)
    );
    core.open_session("session-b", "example.data", false)
        .unwrap();
    assert_eq!(
        core.focus("session-b", "example.data", "body:mars"),
        Err(CoreError::PermissionDenied)
    );
    assert_eq!(core.focused_object(), Some("body:mars"));
}

#[test]
fn release_removes_owned_objects_and_focus_but_preserves_other_sessions() {
    let mut core = Core::default();
    core.open_session("a", "one.plugin", true).unwrap();
    core.open_session("b", "two.plugin", true).unwrap();
    core.register_object("a", "body:earth").unwrap();
    core.register_object("b", "body:moon").unwrap();
    core.focus("b", "two.plugin", "body:earth").unwrap();
    core.release_session("a");
    core.release_session("a");
    assert_eq!(core.focused_object(), None);
    assert_eq!(
        core.focus("a", "one.plugin", "body:moon"),
        Err(CoreError::InactiveSession)
    );
    core.focus("b", "two.plugin", "body:moon").unwrap();
}

#[test]
fn identities_cannot_be_overwritten_or_reused() {
    let mut core = Core::default();
    core.open_session("a", "one.plugin", true).unwrap();
    assert_eq!(
        core.open_session("a", "two.plugin", true),
        Err(CoreError::DuplicateSession)
    );
    core.register_object("a", "body:mars").unwrap();
    assert_eq!(
        core.register_object("a", "body:mars"),
        Err(CoreError::DuplicateObject)
    );
    assert_eq!(core.register_object("a", ""), Err(CoreError::InvalidId));
    core.release_session("a");
    assert_eq!(
        core.open_session("a", "one.plugin", true),
        Err(CoreError::DuplicateSession)
    );
}
