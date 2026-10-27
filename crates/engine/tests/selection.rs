// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::{CommandDispatcher, Engine, PresentedSelection};
use spaceeyes_foundation::{FrameId, ObjectId, Revision};
use spaceeyes_rendering::{prepare_camera, RenderError};
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject, Sphere};
use spaceeyes_time::TimeInstant;

fn selection() -> (PresentedSelection, spaceeyes_engine::SessionStatus) {
    let mut engine = Engine::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    let body = ObjectId::new("body").unwrap();
    let camera = ObjectId::new("camera").unwrap();
    engine.register_root_frame(root.clone()).unwrap();
    engine
        .submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(body.clone())),
                SceneCommand::SetFrame {
                    object: body.clone(),
                    frame: Some(root.clone()),
                },
                SceneCommand::SetSphere {
                    object: body,
                    sphere: Some(Sphere::new(1.0, [1.0, 0.0, 0.0]).unwrap()),
                },
                SceneCommand::Create(SceneObject::new(camera.clone())),
                SceneCommand::SetFrame {
                    object: camera.clone(),
                    frame: Some(root.clone()),
                },
                SceneCommand::SetCamera {
                    object: camera.clone(),
                    camera: Some(
                        CameraState::new([0.0, 0.0, 6.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0)
                            .unwrap(),
                    ),
                },
            ],
        )
        .unwrap();
    engine.start().unwrap();
    let frame = engine.publish_frame(&root).unwrap();
    let prepared = prepare_camera(&frame, &camera, 1.0).unwrap();
    let dispatcher = CommandDispatcher::new(engine, "test".into(), 64).unwrap();
    let status = dispatcher.session_status();
    (
        PresentedSelection::new(&frame, prepared, status.clone()),
        status,
    )
}

#[test]
fn hit_and_miss_read_the_presented_object_without_changing_state() {
    let (selection, status) = selection();
    let object = selection
        .pick(&status, status.frame_sequence, 0.0, 0.0)
        .unwrap()
        .unwrap();
    assert_eq!(object.id().as_str(), "body");
    assert_eq!(object.frame().unwrap().as_str(), "root");
    assert_eq!(object.sphere().unwrap().radius_m(), 1.0);
    assert!(selection
        .pick(&status, status.frame_sequence, 0.9, 0.9)
        .unwrap()
        .is_none());
    assert_eq!(
        selection.pick(&status, status.frame_sequence, f32::NAN, 0.0),
        Err(RenderError::InvalidFrame)
    );
    assert_eq!(
        selection.pick(&status, status.frame_sequence, 1.01, 0.0),
        Err(RenderError::InvalidFrame)
    );
}

#[test]
fn old_sequence_or_any_changed_authoritative_state_rejects_selection() {
    let (selection, status) = selection();
    assert_eq!(
        selection.pick(&status, status.frame_sequence + 1, 0.0, 0.0),
        Err(RenderError::StalePick)
    );
    let mut changed = status.clone();
    changed.scene_revision.0 += 1;
    assert_eq!(
        selection.pick(&changed, status.frame_sequence, 0.0, 0.0),
        Err(RenderError::StalePick)
    );
    changed = status.clone();
    changed.clock.generation.0 += 1;
    assert_eq!(
        selection.pick(&changed, status.frame_sequence, 0.0, 0.0),
        Err(RenderError::StalePick)
    );
    changed = status.clone();
    changed.frame_graph_revision.0 += 1;
    assert_eq!(
        selection.pick(&changed, status.frame_sequence, 0.0, 0.0),
        Err(RenderError::StalePick)
    );
    changed = status.clone();
    changed.resource_revision += 1;
    assert_eq!(
        selection.pick(&changed, status.frame_sequence, 0.0, 0.0),
        Err(RenderError::StalePick)
    );
}
