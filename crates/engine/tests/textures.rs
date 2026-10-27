// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, ResourceId};
use spaceeyes_geometry::{ColorSpace, TextureData};
use spaceeyes_resources::ResourceError;
use spaceeyes_scene::{Material, SceneCommand, SceneObject, Sphere};
use spaceeyes_time::TimeInstant;
#[test]
fn scene_texture_binding_is_typed_shared_transactional_and_restorable() {
    let mut e = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
    let root = FrameId::new("root").unwrap();
    e.register_root_frame(root.clone()).unwrap();
    let texture = ResourceId::new("texture").unwrap();
    e.register_texture_resource(
        texture.clone(),
        TextureData::new(1, 1, vec![255; 4], ColorSpace::Linear).unwrap(),
    )
    .unwrap();
    for name in ["a", "b"] {
        let object = ObjectId::new(name).unwrap();
        e.submit_scene(
            e.scene().revision(),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetFrame {
                    object: object.clone(),
                    frame: Some(root.clone()),
                },
                SceneCommand::SetSphere {
                    object,
                    sphere: Some(
                        Sphere::with_material(
                            1.0,
                            Material::new(
                                [1.0; 3],
                                Some(texture.clone()),
                                Default::default(),
                                true,
                            )
                            .unwrap(),
                        )
                        .unwrap(),
                    ),
                },
            ],
        )
        .unwrap();
    }
    let frame = e.publish_frame(&root).unwrap();
    assert_eq!(frame.textures.len(), 1);
    assert_eq!(
        e.unregister_resource(&texture),
        Err(ResourceError::StillLeased)
    );
    let raw = ResourceId::new("raw").unwrap();
    e.register_resource(raw.clone(), 4).unwrap();
    let before = e.snapshot();
    assert_eq!(
        e.submit_scene(
            e.scene().revision(),
            &[SceneCommand::SetSphere {
                object: ObjectId::new("a").unwrap(),
                sphere: Some(
                    Sphere::with_material(
                        1.0,
                        Material::new([1.0; 3], Some(raw), Default::default(), false).unwrap()
                    )
                    .unwrap()
                )
            }]
        ),
        Err(CoreError::ResourceUnavailable)
    );
    assert_eq!(e.snapshot(), before);
    let restored = Engine::restore_project(&e.project_state(), &[]).unwrap();
    assert_eq!(
        restored.publish_frame(&root).unwrap().textures[0]
            .texture
            .rgba8(),
        &[255; 4]
    );
    for name in ["a", "b"] {
        e.submit_scene(
            e.scene().revision(),
            &[SceneCommand::Delete {
                object: ObjectId::new(name).unwrap(),
            }],
        )
        .unwrap();
    }
    e.unregister_resource(&texture).unwrap();
    assert_eq!(frame.textures[0].texture.rgba8(), &[255; 4]);
}
