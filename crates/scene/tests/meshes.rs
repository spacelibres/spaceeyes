// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{CoreError, ObjectId, ResourceId, Revision};
use spaceeyes_scene::{MeshInstance, Scene, SceneCommand, SceneObject, Sphere};
#[test]
fn mesh_display_component_is_exclusive_and_removal_preserves_explicit_references() {
    let resource = ResourceId::new("geometry").unwrap();
    assert!(MeshInstance::new(resource.clone(), [f32::NAN, 0.0, 0.0]).is_err());
    let id = ObjectId::new("object").unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetResources {
                    object: id.clone(),
                    resources: vec![resource.clone()],
                },
                SceneCommand::SetMesh {
                    object: id.clone(),
                    mesh: Some(MeshInstance::new(resource.clone(), [1.0; 3]).unwrap()),
                },
            ],
        )
        .unwrap();
    let before = scene.snapshot();
    assert_eq!(scene.get(&id).unwrap().resource_refs(), vec![&resource]);
    assert_eq!(
        scene.apply_transaction(
            Revision(1),
            &[SceneCommand::SetSphere {
                object: id.clone(),
                sphere: Some(Sphere::new(1.0, [1.0; 3]).unwrap())
            }]
        ),
        Err(CoreError::InvalidState)
    );
    assert_eq!(scene.snapshot(), before);
    scene
        .apply_transaction(
            Revision(1),
            &[SceneCommand::SetMesh {
                object: id.clone(),
                mesh: None,
            }],
        )
        .unwrap();
    assert!(scene.get(&id).unwrap().mesh().is_none());
    assert_eq!(scene.get(&id).unwrap().resources(), &[resource]);
}
