// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C04: explicit frame derivatives, honest missing-derivative errors, bounded cache.
use spaceeyes_foundation::FrameId;
use spaceeyes_spatial::{
    FrameDerivative, FrameSample, ProviderRef, Quatd, ReferenceFrameGraph, RigidTransform,
    SpatialError, TransformProvider, Vec3d,
};
use spaceeyes_time::TimeInstant;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn id(value: &str) -> FrameId {
    FrameId::new(value).unwrap()
}

fn at() -> TimeInstant {
    TimeInstant::new("TT", "epoch", 0, 0).unwrap()
}

/// Rigid transform plus an instantaneous derivative; not a trajectory model.
#[derive(Debug)]
struct Edge {
    id: &'static str,
    transform: RigidTransform,
    derivative: Option<FrameDerivative>,
    calls: AtomicUsize,
}
impl Edge {
    fn new(
        id: &'static str,
        transform: RigidTransform,
        derivative: Option<FrameDerivative>,
    ) -> Self {
        Self {
            id,
            transform,
            derivative,
            calls: AtomicUsize::new(0),
        }
    }
}
impl TransformProvider for Edge {
    fn provider_id(&self) -> &str {
        self.id
    }
    fn version(&self) -> &str {
        "1"
    }
    fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        if instant.scale() != "TT" || instant.epoch() != "epoch" {
            return Err(SpatialError::TimeNotCovered);
        }
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(self.transform)
    }
    fn derivative_at(
        &self,
        _instant: &TimeInstant,
    ) -> Result<Option<FrameDerivative>, SpatialError> {
        Ok(self.derivative)
    }
}

fn spin(angular_z: f64) -> FrameDerivative {
    FrameDerivative {
        linear_velocity_m_s: Vec3d::ZERO,
        angular_velocity_rad_s: Vec3d {
            x: 0.0,
            y: 0.0,
            z: angular_z,
        },
    }
}

#[test]
fn rotating_frame_velocity_includes_the_angular_term() {
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    let spinner = ProviderRef::new(Arc::new(Edge::new(
        "spin",
        RigidTransform::IDENTITY,
        Some(spin(1.0)),
    )))
    .unwrap();
    graph
        .register_dynamic_child(id("spinner"), id("root"), spinner)
        .unwrap();

    let state = graph
        .resolve_state(&id("spinner"), &id("root"), &at())
        .unwrap();
    assert_eq!(state.transform.translation_m, Vec3d::ZERO);
    assert_eq!(
        state.derivative.angular_velocity_rad_s,
        Vec3d {
            x: 0.0,
            y: 0.0,
            z: 1.0
        }
    );
    assert_eq!(
        state.point_velocity(Vec3d {
            x: 1.0,
            y: 0.0,
            z: 0.0
        }),
        Vec3d {
            x: 0.0,
            y: 1.0,
            z: 0.0
        }
    );
}

#[test]
fn chained_rotation_composes_and_inverse_negates_angular_velocity() {
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    for (name, rate) in [("a", 1.0), ("b", 2.0)] {
        let provider = ProviderRef::new(Arc::new(Edge::new(
            name,
            RigidTransform::IDENTITY,
            Some(spin(rate)),
        )))
        .unwrap();
        let parent = if name == "a" { id("root") } else { id("a") };
        graph
            .register_dynamic_child(id(name), parent, provider)
            .unwrap();
    }
    let forward = graph.resolve_state(&id("b"), &id("root"), &at()).unwrap();
    assert_eq!(forward.derivative.angular_velocity_rad_s.z, 3.0);
    let backward = graph.resolve_state(&id("root"), &id("b"), &at()).unwrap();
    assert_eq!(backward.derivative.angular_velocity_rad_s.z, -3.0);
    assert_eq!(backward.derivative.linear_velocity_m_s, Vec3d::ZERO);
}

#[test]
fn translation_velocity_flips_sign_under_inverse_and_includes_offset_rotation() {
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    let mover = ProviderRef::new(Arc::new(Edge::new(
        "mover",
        RigidTransform::new(
            Vec3d {
                x: 1.0,
                y: 0.0,
                z: 0.0,
            },
            Quatd::IDENTITY,
        )
        .unwrap(),
        Some(FrameDerivative {
            linear_velocity_m_s: Vec3d {
                x: 0.5,
                y: 0.0,
                z: 0.0,
            },
            angular_velocity_rad_s: Vec3d {
                x: 0.0,
                y: 0.0,
                z: 1.0,
            },
        }),
    )))
    .unwrap();
    graph
        .register_dynamic_child(id("mover"), id("root"), mover)
        .unwrap();

    let forward = graph
        .resolve_state(&id("mover"), &id("root"), &at())
        .unwrap();
    assert_eq!(forward.derivative.linear_velocity_m_s.x, 0.5);
    // The child origin is offset by +x while rotating about its own origin, so a
    // point at the child origin moves only with the declared linear velocity.
    assert_eq!(forward.point_velocity(Vec3d::ZERO).x, 0.5);

    let backward = graph
        .resolve_state(&id("root"), &id("mover"), &at())
        .unwrap();
    // ω × t - v = (0,1,0) - (0.5,0,0), expressed in the (identity) child frame.
    assert_eq!(backward.derivative.linear_velocity_m_s.x, -0.5);
    assert_eq!(backward.derivative.linear_velocity_m_s.y, 1.0);
}

#[test]
fn missing_derivatives_are_explicit_errors_for_samples_and_providers() {
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    graph
        .register_child(
            id("static"),
            id("root"),
            FrameSample {
                instant: at(),
                to_parent: RigidTransform::IDENTITY,
            },
        )
        .unwrap();
    let plain =
        ProviderRef::new(Arc::new(Edge::new("plain", RigidTransform::IDENTITY, None))).unwrap();
    graph
        .register_dynamic_child(id("plain"), id("root"), plain)
        .unwrap();
    let _ = graph.register_provider_child(id("hosted"), id("root"), "nasa.dyn".into(), "1".into());
    let _ = graph.update_provider_sample(
        &id("hosted"),
        FrameSample {
            instant: at(),
            to_parent: RigidTransform::IDENTITY,
        },
    );

    for frame in ["static", "plain", "hosted"] {
        assert_eq!(
            graph.resolve_state(&id(frame), &id("root"), &at()),
            Err(SpatialError::DerivativeUnavailable),
            "{frame} must not fabricate zero velocity"
        );
    }
    // Position resolution still works for static samples.
    assert_eq!(
        graph.resolve(&id("static"), &id("root"), &at()),
        Ok(RigidTransform::IDENTITY)
    );
}

#[test]
fn resolution_cache_is_per_revision_and_bounded() {
    let edge = Arc::new(Edge::new(
        "cached",
        RigidTransform::IDENTITY,
        Some(spin(1.0)),
    ));
    let provider = ProviderRef::new(edge.clone()).unwrap();
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    graph
        .register_dynamic_child(id("cached"), id("root"), provider)
        .unwrap();
    graph.resolve(&id("cached"), &id("root"), &at()).unwrap();
    graph.resolve(&id("cached"), &id("root"), &at()).unwrap();
    assert_eq!(edge.calls.load(Ordering::Relaxed), 1);
    // Any graph mutation bumps the revision and invalidates the memo.
    graph.register_root(id("other")).unwrap();
    graph.resolve(&id("cached"), &id("root"), &at()).unwrap();
    assert_eq!(edge.calls.load(Ordering::Relaxed), 2);
}
