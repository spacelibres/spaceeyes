use spaceeyes_foundation::{CoreError, ObjectId, Revision};
use spaceeyes_scene::{Scene, SceneCommand, SceneObject};
#[test]
fn handles_reject_deletion_recreation_and_other_registries() {
    let id = ObjectId::new("sample").unwrap();
    let mut scene = Scene::new();
    scene.create(SceneObject::new(id.clone())).unwrap();
    let old = scene.handle(&id).unwrap();
    let mut other = Scene::new();
    other.create(SceneObject::new(id.clone())).unwrap();
    assert_eq!(other.get_by_handle(&old), Err(CoreError::InvalidHandle));
    scene
        .apply_transaction(
            Revision(1),
            &[
                SceneCommand::Delete { object: id.clone() },
                SceneCommand::Create(SceneObject::new(id.clone())),
            ],
        )
        .unwrap();
    assert_eq!(scene.get_by_handle(&old), Err(CoreError::InvalidHandle));
    assert_eq!(
        scene
            .get_by_handle(&scene.handle(&id).unwrap())
            .unwrap()
            .id(),
        &id
    );
}
#[test]
fn failed_transaction_preserves_live_handles() {
    let mut scene = Scene::new();
    let id = ObjectId::new("sample").unwrap();
    scene.create(SceneObject::new(id.clone())).unwrap();
    let handle = scene.handle(&id).unwrap();
    assert!(scene
        .apply_transaction(
            Revision(1),
            &[
                SceneCommand::Delete { object: id.clone() },
                SceneCommand::Delete { object: id.clone() }
            ]
        )
        .is_err());
    assert!(scene.get_by_handle(&handle).is_ok());
    assert_eq!(scene.revision(), Revision(1));
}
