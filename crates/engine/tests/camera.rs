use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, Revision};
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject};
use spaceeyes_time::TimeInstant;
#[test]
fn camera_transactions_preserve_frame_requirements_and_project_state() {
    let mut engine = Engine::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    engine.register_root_frame(root.clone()).unwrap();
    let id = ObjectId::new("camera").unwrap();
    let camera = CameraState::new([2.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap();
    engine
        .submit_scene(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetFrame {
                    object: id.clone(),
                    frame: Some(root),
                },
                SceneCommand::SetCamera {
                    object: id.clone(),
                    camera: Some(camera.clone()),
                },
            ],
        )
        .unwrap();
    let before = engine.snapshot();
    assert_eq!(
        engine.submit_scene(
            Revision(1),
            &[SceneCommand::SetFrame {
                object: id.clone(),
                frame: None
            }]
        ),
        Err(CoreError::UnknownFrame)
    );
    assert_eq!(engine.snapshot(), before);
    let restored = Engine::restore_project(&engine.project_state(), &[]).unwrap();
    assert_eq!(restored.scene().get(&id).unwrap().camera(), Some(&camera));
    assert_eq!(
        engine.submit_scene(
            Revision(1),
            &[SceneCommand::SetCamera {
                object: ObjectId::new("missing").unwrap(),
                camera: Some(camera)
            }]
        ),
        Err(CoreError::UnknownObject)
    );
    engine
        .submit_scene(
            Revision(1),
            &[
                SceneCommand::SetCamera {
                    object: id.clone(),
                    camera: None,
                },
                SceneCommand::SetFrame {
                    object: id,
                    frame: None,
                },
            ],
        )
        .unwrap();
}
