// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{Sampling, TextureAddress, TextureFilter};
use spaceeyes_scene::{Material, MeshInstance, Scene, SceneCommand, SceneObject, Sphere};
#[test]
fn material_validation_and_implicit_texture_refs_are_consistent() {
    assert!(Material::new([f32::NAN, 0.0, 0.0], None, Default::default(), false).is_err());
    let id = ResourceId::new("texture").unwrap();
    let material = Material::new(
        [0.5; 3],
        Some(id.clone()),
        Sampling {
            filter: TextureFilter::Linear,
            address: TextureAddress::Repeat,
        },
        true,
    )
    .unwrap();
    let sphere = Sphere::with_material(1.0, material.clone()).unwrap();
    assert_eq!(sphere.material(), &material);
    let object = ObjectId::new("object").unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(object.clone())),
                SceneCommand::SetResources {
                    object: object.clone(),
                    resources: vec![id.clone()],
                },
                SceneCommand::SetMesh {
                    object: object.clone(),
                    mesh: Some(MeshInstance::with_material(
                        ResourceId::new("mesh").unwrap(),
                        material,
                    )),
                },
            ],
        )
        .unwrap();
    assert_eq!(scene.get(&object).unwrap().resource_refs().len(), 2);
    assert!(Sphere::new(1.0, [1.0; 3])
        .unwrap()
        .material()
        .texture()
        .is_none());
}
