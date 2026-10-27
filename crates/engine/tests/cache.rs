// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{ObjectId, ResourceId, Revision};
use spaceeyes_resources::ResourceError;
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;

fn instant() -> TimeInstant {
    TimeInstant::new("TT", "prototype", 0, 0).unwrap()
}

fn ready(engine: &mut Engine, id: &ResourceId, bytes: usize) {
    engine.declare_resource(id.clone(), bytes as u64).unwrap();
    let token = engine.begin_resource_load(id).unwrap();
    engine.finish_resource_load(&token, vec![0; bytes]).unwrap();
}

#[test]
fn engine_eviction_respects_scene_leases_and_stop() {
    let mut engine = Engine::new(instant());
    let leased = ResourceId::new("leased").unwrap();
    let spare = ResourceId::new("spare").unwrap();
    ready(&mut engine, &leased, 8);
    ready(&mut engine, &spare, 8);
    let object = ObjectId::new("object").unwrap();
    engine
        .submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetResources {
                    object: object.clone(),
                    resources: vec![leased.clone()],
                },
            ],
        )
        .unwrap();

    assert_eq!(
        engine.evict_resource_cache(100).unwrap(),
        vec![spare.clone()]
    );
    assert_eq!(engine.resource_usage().cpu_bytes, 8);
    assert!(engine.evict_resource_cache(100).unwrap().is_empty());

    engine
        .submit_scene(
            engine.scene().revision(),
            &[SceneCommand::Delete { object }],
        )
        .unwrap();
    assert_eq!(engine.evict_resource_cache(100).unwrap(), vec![leased]);
    assert_eq!(engine.resource_usage().cpu_bytes, 0);

    engine.shutdown();
    assert_eq!(
        engine.evict_resource_cache(1),
        Err(ResourceError::EngineUnavailable)
    );
}
