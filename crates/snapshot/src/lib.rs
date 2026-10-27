// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Immutable frame values shared by Engine and Renderer; no mutable module ownership.
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{TextureData, TriangleMesh};
use spaceeyes_scene::SceneSnapshot;
use spaceeyes_spatial::RigidTransform;
use spaceeyes_time::ClockSnapshot;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameAvailability {
    Complete,
    Partial,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectPose {
    pub object: ObjectId,
    pub transform: RigidTransform,
}
#[derive(Clone, Debug, PartialEq)]
pub struct FrameSnapshot {
    pub meshes: Vec<MeshAsset>,
    pub textures: Vec<TextureAsset>,
    pub sequence: u64,
    pub scene: SceneSnapshot,
    pub clock: ClockSnapshot,
    pub reference: FrameId,
    pub frame_graph_revision: Revision,
    pub resource_revision: u64,
    pub availability: FrameAvailability,
    pub poses: Vec<ObjectPose>,
    pub unresolved: Vec<ObjectId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeshAsset {
    pub resource: ResourceId,
    pub geometry: Arc<TriangleMesh>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextureAsset {
    pub resource: ResourceId,
    pub texture: Arc<TextureData>,
}
