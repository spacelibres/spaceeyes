use spaceeyes_core::{Core, CoreError, ObjectState, SimulationClock};

fn state(x: f64) -> ObjectState {
    ObjectState {
        position_km: [x, 0.0, 0.0],
        radius_km: 6378.0,
        epoch_tdb_seconds: 10.0,
        coverage_tdb_seconds: [0.0, 20.0],
        frame: "ICRF".into(),
        source: "fixture:test".into(),
    }
}

#[test]
fn scientific_state_is_owned_validated_and_not_silently_extrapolated() {
    let mut core = Core::default();
    core.open_session("a", "one.plugin", true).unwrap();
    core.open_session("b", "two.plugin", true).unwrap();
    core.register_object("a", "body:earth").unwrap();
    core.set_object_state("a", "body:earth", state(1.0e12))
        .unwrap();
    assert_eq!(
        core.set_object_state("b", "body:earth", state(1.0)),
        Err(CoreError::WrongOwner)
    );
    let mut invalid = state(f64::NAN);
    assert_eq!(
        core.set_object_state("a", "body:earth", invalid.clone()),
        Err(CoreError::InvalidState)
    );
    invalid.position_km[0] = 0.0;
    invalid.epoch_tdb_seconds = 21.0;
    assert_eq!(
        core.set_object_state("a", "body:earth", invalid),
        Err(CoreError::InvalidState)
    );
    assert!(core.object_state_at("body:earth", 10.0).is_ok());
    assert_eq!(
        core.object_state_at("body:earth", 11.0),
        Err(CoreError::StaleState)
    );
    assert_eq!(
        core.object_state_at("body:earth", 21.0),
        Err(CoreError::OutsideCoverage)
    );
    core.release_session("a");
    assert_eq!(
        core.object_state_at("body:earth", 10.0),
        Err(CoreError::UnknownObject)
    );
}

#[test]
fn clock_pause_rate_and_seek_are_explicit_and_reject_invalid_updates() {
    let mut clock = SimulationClock::default();
    clock.seek(10.0).unwrap();
    clock.advance(1.0).unwrap();
    assert_eq!(clock.epoch(), 10.0);
    clock.set_rate(-2.0).unwrap();
    clock.set_playing(true);
    clock.advance(3.0).unwrap();
    assert_eq!(clock.epoch(), 4.0);
    assert_eq!(clock.advance(-1.0), Err(CoreError::InvalidTime));
    assert_eq!(clock.set_rate(f64::INFINITY), Err(CoreError::InvalidTime));
    assert_eq!(clock.seek(f64::NAN), Err(CoreError::InvalidTime));
    assert_eq!(clock.epoch(), 4.0);
}
