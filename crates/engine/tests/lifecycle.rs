// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C10: explicit Created/Initializing/Ready/Stopping/Failed/Stopped transitions.
use spaceeyes_engine::{Engine, EngineState};
use spaceeyes_foundation::{CoreError, ObjectId, ResourceId, Revision};
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;

fn instant() -> TimeInstant {
    TimeInstant::new("TT", "explicit", 0, 0).unwrap()
}

fn create() -> SceneCommand {
    SceneCommand::Create(SceneObject::new(ObjectId::new("body").unwrap()))
}

#[test]
fn created_engine_rejects_work_until_initialized() {
    let mut engine = Engine::prepare(instant());
    assert_eq!(engine.state(), EngineState::Created);
    assert!(engine.submit_scene(Revision(0), &[create()]).is_err());
    assert_eq!(engine.start(), Err(CoreError::InvalidState));
    assert_eq!(
        engine.register_resource(ResourceId::new("asset").unwrap(), 4),
        Err(spaceeyes_resources::ResourceError::EngineUnavailable)
    );
    engine.initialize(|_| Ok(())).unwrap();
    assert_eq!(engine.state(), EngineState::Ready);
    engine.submit_scene(Revision(0), &[create()]).unwrap();
    engine.start().unwrap();
    assert_eq!(engine.state(), EngineState::Running);
}

#[test]
fn initialization_failure_releases_reservations_and_enters_failed() {
    let mut engine = Engine::prepare(instant());
    let result = engine.initialize(|inner| {
        inner
            .register_resource(ResourceId::new("asset").unwrap(), 8)
            .map_err(|_| CoreError::InvalidState)?;
        Err(CoreError::InvalidState)
    });
    assert_eq!(result, Err(CoreError::InvalidState));
    assert_eq!(engine.state(), EngineState::Failed);
    assert_eq!(engine.resource_used_bytes(), 0);
    assert!(engine.submit_scene(Revision(0), &[create()]).is_err());
    // A failed engine can still be cleaned up into the terminal state.
    engine.shutdown();
    assert_eq!(engine.state(), EngineState::Stopped);
    assert_eq!(engine.resource_used_bytes(), 0);
}

#[test]
fn stopping_rejects_writes_before_resources_are_released() {
    let mut engine = Engine::new(instant());
    engine
        .register_resource(ResourceId::new("asset").unwrap(), 8)
        .unwrap();
    engine.start().unwrap();
    engine.begin_shutdown();
    assert_eq!(engine.state(), EngineState::Stopping);
    assert!(engine.submit_scene(Revision(0), &[create()]).is_err());
    assert_eq!(
        engine.register_resource(ResourceId::new("late").unwrap(), 1),
        Err(spaceeyes_resources::ResourceError::EngineUnavailable)
    );
    assert_eq!(
        engine.resource_used_bytes(),
        8,
        "Stopping keeps resources until the explicit release phase"
    );
    engine.finish_shutdown();
    assert_eq!(engine.state(), EngineState::Stopped);
    assert_eq!(engine.resource_used_bytes(), 0);
}

#[test]
fn shutdown_is_idempotent_from_every_state() {
    for mut engine in [Engine::new(instant()), Engine::prepare(instant())] {
        engine.shutdown();
        engine.shutdown();
        assert_eq!(engine.state(), EngineState::Stopped);
    }
}
