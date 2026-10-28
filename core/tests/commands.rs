use spaceeyes_core::{Core, CoreError, ObjectState, SessionPermissions};

fn sample() -> ObjectState {
    ObjectState {
        position_km: [0.0; 3],
        radius_km: 1.0,
        epoch_tdb_seconds: 0.0,
        coverage_tdb_seconds: [0.0, 1.0],
        frame: "ICRF".into(),
        source: "test".into(),
    }
}

#[test]
fn publishing_and_removal_enforce_permissions_and_ownership_atomically() {
    let mut core = Core::default();
    core.open_session_with_permissions(
        "a",
        "one.plugin",
        SessionPermissions {
            data_publish: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.open_session_with_permissions(
        "b",
        "two.plugin",
        SessionPermissions {
            data_publish: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.open_session("c", "no.permission", false).unwrap();
    assert_eq!(
        core.publish_object("c", "no.permission", "body:x", sample()),
        Err(CoreError::PermissionDenied)
    );
    let mut invalid = sample();
    invalid.radius_km = -1.0;
    assert_eq!(
        core.publish_object("a", "one.plugin", "body:x", invalid),
        Err(CoreError::InvalidState)
    );
    core.publish_object("b", "two.plugin", "body:x", sample())
        .unwrap();
    assert_eq!(
        core.publish_object("a", "one.plugin", "body:x", sample()),
        Err(CoreError::WrongOwner)
    );
    assert_eq!(
        core.remove_object("a", "one.plugin", "body:x"),
        Err(CoreError::WrongOwner)
    );
    core.remove_object("b", "two.plugin", "body:x").unwrap();
    assert_eq!(
        core.object_state_at("body:x", 0.0),
        Err(CoreError::UnknownObject)
    );
}

#[test]
fn time_commands_require_explicit_authority_and_do_not_mutate_on_failure() {
    let mut core = Core::default();
    core.open_session("a", "no.time", true).unwrap();
    assert_eq!(
        core.seek("a", "no.time", 42.0),
        Err(CoreError::PermissionDenied)
    );
    core.open_session_with_permissions(
        "t",
        "time.plugin",
        SessionPermissions {
            time_control: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.seek("t", "time.plugin", 42.0).unwrap();
    core.set_playback("t", "time.plugin", true, 2.0).unwrap();
    core.tick(3.0).unwrap();
    assert_eq!(core.clock().epoch(), 48.0);
    assert_eq!(
        core.set_playback("t", "time.plugin", false, f64::NAN),
        Err(CoreError::InvalidTime)
    );
    assert!(core.clock().is_playing());
    core.release_session("t");
    assert!(!core.clock().is_playing());
}
