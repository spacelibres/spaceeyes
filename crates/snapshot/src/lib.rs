// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Immutable frame values shared by Engine and Renderer; no mutable module ownership.
use spaceeyes_foundation::{FrameId, ObjectId, ResourceId, Revision};
use spaceeyes_geometry::{TextureData, TriangleMesh};
pub use spaceeyes_scene::CameraProjection;
use spaceeyes_scene::SceneSnapshot;
use spaceeyes_spatial::RigidTransform;
use spaceeyes_time::{ClockSnapshot, TimeGeneration};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameAvailability {
    /// Every referenced pose and asset resolved for this session and instant.
    Complete,
    /// Some referenced object could not resolve; never report this as a full state.
    Partial,
    /// A retained earlier frame used only for visual fallback, never as the current
    /// scientific state. A fresh consistent capture never produces this value.
    Stale,
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
    /// Session identity the frame was captured for. Empty only when no host session is bound.
    pub session: String,
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

impl FrameSnapshot {
    pub fn is_stale(&self) -> bool {
        self.availability == FrameAvailability::Stale
    }
}

/// Immutable record of one atomic snapshot publication.
/// Emitted as the FramePublished event with `stale: false`; the record retained by the
/// Engine becomes stale when a later publication fails or the session state advances.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FramePublished {
    pub session: String,
    pub sequence: u64,
    pub generation: TimeGeneration,
    pub availability: FrameAvailability,
    pub scene_revision: Revision,
    pub frame_graph_revision: Revision,
    pub resource_revision: u64,
    pub stale: bool,
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
