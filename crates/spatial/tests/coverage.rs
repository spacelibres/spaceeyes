// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C04: declared provider coverage, never an inferred range.
use spaceeyes_foundation::FrameId;
use spaceeyes_spatial::{
    FrameSample, ProviderRef, Quatd, ReferenceFrameGraph, RigidTransform, SpatialError,
    TransformProvider, Vec3d,
};
use spaceeyes_time::TimeInstant;
use std::sync::Arc;

fn id(value: &str) -> FrameId {
    FrameId::new(value).unwrap()
}

fn at(seconds: i64) -> TimeInstant {
    TimeInstant::new("TT", "epoch", seconds, 0).unwrap()
}

#[derive(Debug)]
struct Covered {
    coverage: Option<(TimeInstant, TimeInstant)>,
}
impl TransformProvider for Covered {
    fn provider_id(&self) -> &str {
        "example.covered"
    }
    fn version(&self) -> &str {
        "2"
    }
    fn resolve_at(&self, _instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        Ok(RigidTransform::IDENTITY)
    }
    fn coverage(&self) -> Option<(TimeInstant, TimeInstant)> {
        self.coverage.clone()
    }
}

fn graph(coverage: Option<(TimeInstant, TimeInstant)>) -> ReferenceFrameGraph {
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    let provider = ProviderRef::new(Arc::new(Covered { coverage })).unwrap();
    graph
        .register_dynamic_child(id("moving"), id("root"), provider)
        .unwrap();
    graph
}

#[test]
fn dynamic_provider_reports_identity_and_declared_range() {
    let graph = graph(Some((at(0), at(10))));
    let coverage = graph.coverage(&id("moving")).unwrap().unwrap();
    assert_eq!(coverage.provider_id, "example.covered");
    assert_eq!(coverage.provider_version, "2");
    assert_eq!((coverage.start.seconds(), coverage.end.seconds()), (0, 10));
}

#[test]
fn providers_without_coverage_and_static_samples_report_none() {
    assert_eq!(graph(None).coverage(&id("moving")).unwrap(), None);
    let mut graph = ReferenceFrameGraph::new();
    graph.register_root(id("root")).unwrap();
    graph
        .register_child(
            id("static"),
            id("root"),
            FrameSample {
                instant: at(0),
                to_parent: RigidTransform::new(
                    Vec3d {
                        x: 1.0,
                        y: 0.0,
                        z: 0.0,
                    },
                    Quatd::IDENTITY,
                )
                .unwrap(),
            },
        )
        .unwrap();
    assert_eq!(graph.coverage(&id("static")).unwrap(), None);
    assert_eq!(
        graph.coverage(&id("missing")),
        Err(SpatialError::UnknownFrame)
    );
}

#[test]
fn invalid_declared_ranges_are_rejected() {
    assert_eq!(
        graph(Some((at(10), at(0)))).coverage(&id("moving")),
        Err(SpatialError::InvalidProvider)
    );
    let mixed = Some((at(0), TimeInstant::new("TDB", "epoch", 10, 0).unwrap()));
    assert_eq!(
        graph(mixed).coverage(&id("moving")),
        Err(SpatialError::InvalidProvider)
    );
}
