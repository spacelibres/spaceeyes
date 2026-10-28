// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::{ObjectId, Revision};
use spaceeyes_scene::{LinePrimitive, Scene, SceneCommand, SceneObject, MAX_LINE_POINTS};

#[test]
fn line_primitives_require_two_or_more_finite_points() {
    let line = LinePrimitive::new(vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], [1.0, 0.0, 0.0]).unwrap();
    assert_eq!(line.points_m().len(), 2);
    assert_eq!(line.color(), [1.0, 0.0, 0.0]);
    for points in [
        vec![],
        vec![[0.0, 0.0, 0.0]],
        vec![[0.0, 0.0, 0.0]; MAX_LINE_POINTS + 1],
        vec![[f64::NAN, 0.0, 0.0], [1.0, 0.0, 0.0]],
    ] {
        assert!(LinePrimitive::new(points, [1.0, 1.0, 1.0]).is_err());
    }
    assert!(LinePrimitive::new(
        vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
        [f64::INFINITY as f32, 0.0, 0.0]
    )
    .is_err());
}

#[test]
fn line_component_is_transactional_and_removable() {
    let id = ObjectId::new("orbit").unwrap();
    let line = LinePrimitive::new(
        vec![[0.0, 0.0, 0.0], [1.0, 2.0, 0.0], [2.0, 0.0, 0.0]],
        [0.2, 0.6, 1.0],
    )
    .unwrap();
    let mut scene = Scene::new();
    scene
        .apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id.clone())),
                SceneCommand::SetLine {
                    object: id.clone(),
                    line: Some(line.clone()),
                },
            ],
        )
        .unwrap();
    assert_eq!(scene.get(&id).unwrap().line(), Some(&line));
    scene
        .apply_transaction(
            Revision(1),
            &[SceneCommand::SetLine {
                object: id.clone(),
                line: None,
            }],
        )
        .unwrap();
    assert!(scene.get(&id).unwrap().line().is_none());
    let before = scene.snapshot();
    assert_eq!(
        scene.apply_transaction(
            Revision(2),
            &[SceneCommand::SetLine {
                object: ObjectId::new("missing").unwrap(),
                line: Some(line),
            }]
        ),
        Err(spaceeyes_foundation::CoreError::UnknownObject)
    );
    assert_eq!(scene.snapshot(), before);
}
