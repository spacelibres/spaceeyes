// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_foundation::FrameId;
use spaceeyes_spatial::{FrameSample, Quatd, ReferenceFrameGraph, RigidTransform, Vec3d};
use spaceeyes_time::TimeInstant;
fn id(s: &str) -> FrameId {
    FrameId::new(s).unwrap()
}
#[test]
fn common_ancestor_does_not_require_unrelated_coverage() {
    let mut g = ReferenceFrameGraph::new();
    let t = TimeInstant::new("TT", "epoch", 0, 0).unwrap();
    let later = t.checked_add_nanos(1).unwrap();
    g.register_root(id("root")).unwrap();
    g.register_child(
        id("parent"),
        id("root"),
        FrameSample {
            instant: t,
            to_parent: RigidTransform::IDENTITY,
        },
    )
    .unwrap();
    for (name, x) in [("a", 2.0), ("b", 5.0)] {
        g.register_child(
            id(name),
            id("parent"),
            FrameSample {
                instant: later.clone(),
                to_parent: RigidTransform {
                    translation_m: Vec3d { x, y: 0.0, z: 0.0 },
                    rotation: Quatd {
                        w: 2.0,
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                    },
                },
            },
        )
        .unwrap();
    }
    let r = g.resolve(&id("a"), &id("b"), &later).unwrap();
    assert!((r.translation_m.x + 3.0).abs() < 1e-12);
    assert!((r.rotation.w - 1.0).abs() < 1e-12);
    assert!(g.resolve(&id("a"), &id("root"), &later).is_err());
}
