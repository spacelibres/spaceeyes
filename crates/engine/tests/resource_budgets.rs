// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, ObjectId, ResourceId, Revision};
use spaceeyes_resources::{ResourceError, ResourceLimits};
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;

#[test]
fn runtime_allocations_are_not_scene_assets_or_project_records() {
    let limits = ResourceLimits {
        total_bytes: 100,
        cpu_bytes: 60,
        gpu_bytes: 50,
        staging_bytes: 20,
    };
    let mut engine =
        Engine::with_resource_limits(TimeInstant::new("TT", "prototype", 0, 0).unwrap(), limits);
    let cpu = ResourceId::new("asset").unwrap();
    let gpu = ResourceId::new("surface").unwrap();
    engine.register_resource(cpu, 50).unwrap();
    engine.register_gpu_resource(gpu.clone(), 40).unwrap();
    let lease = engine.lease_resource(&gpu).unwrap();
    let before = engine.snapshot();
    let usage = engine.resource_usage();
    let object = ObjectId::new("object").unwrap();
    assert_eq!(
        engine.submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetResources {
                    object,
                    resources: vec![gpu.clone()]
                },
            ]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert_eq!(engine.snapshot(), before);
    assert_eq!(engine.resource_usage(), usage);
    let project = engine.project_state();
    assert_eq!(project.resources.len(), 1);
    let restored = Engine::restore_project_with_limits(&project, &[], limits).unwrap();
    assert_eq!(restored.resource_limits(), limits);
    assert_eq!(restored.resource_usage().total_bytes, 50);
    assert_eq!(restored.resource_usage().gpu_bytes, 0);
    let mut small = limits;
    small.cpu_bytes = 49;
    assert!(Engine::restore_project_with_limits(&project, &[], small).is_err());
    engine.shutdown();
    assert_eq!(engine.resource_usage().total_bytes, 0);
    assert_eq!(engine.resource_limits(), limits);
    assert_eq!(
        engine.release_resource_lease(&lease),
        Err(ResourceError::InvalidLease)
    );
}
