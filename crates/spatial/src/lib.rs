// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Generic reference-frame graph with time-explicit rigid transforms.
//! No NASA data, ephemeris computation, or implicit system clock.
use spaceeyes_foundation::{FrameId, Revision};
use spaceeyes_time::TimeInstant;
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
mod provider;
pub use provider::{ProviderRef, TransformProvider};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpatialError {
    UnknownFrame,
    DuplicateFrame,
    InvalidParent,
    Cycle,
    FrameHasChildren,
    Disconnected,
    InvalidTransform,
    TimeNotCovered,
    MissingTransform,
    RevisionOverflow,
    EngineUnavailable,
    InvalidProvider,
    /// A velocity/derivative request crossed a frame whose derivative is unknown.
    DerivativeUnavailable,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
impl Vec3d {
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    fn finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
    fn add(self, rhs: Self) -> Self {
        Self {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
            z: self.z + rhs.z,
        }
    }
    fn sub(self, rhs: Self) -> Self {
        Self {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
            z: self.z - rhs.z,
        }
    }
    fn cross(self, rhs: Self) -> Self {
        Self {
            x: self.y * rhs.z - self.z * rhs.y,
            y: self.z * rhs.x - self.x * rhs.z,
            z: self.x * rhs.y - self.y * rhs.x,
        }
    }
    fn neg(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quatd {
    pub w: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
impl Quatd {
    pub const IDENTITY: Self = Self {
        w: 1.0,
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    fn finite(self) -> bool {
        [self.w, self.x, self.y, self.z]
            .iter()
            .all(|v| v.is_finite())
    }
    fn norm_squared(self) -> f64 {
        self.w * self.w + self.x * self.x + self.y * self.y + self.z * self.z
    }
    fn normalized(self) -> Result<Self, SpatialError> {
        if !self.finite() {
            return Err(SpatialError::InvalidTransform);
        }
        let norm = self.norm_squared().sqrt();
        if !norm.is_finite() || norm <= 1e-12 {
            return Err(SpatialError::InvalidTransform);
        }
        Ok(Self {
            w: self.w / norm,
            x: self.x / norm,
            y: self.y / norm,
            z: self.z / norm,
        })
    }
    fn conjugate(self) -> Self {
        Self {
            w: self.w,
            x: -self.x,
            y: -self.y,
            z: -self.z,
        }
    }
    fn mul(self, b: Self) -> Self {
        Self {
            w: self.w * b.w - self.x * b.x - self.y * b.y - self.z * b.z,
            x: self.w * b.x + self.x * b.w + self.y * b.z - self.z * b.y,
            y: self.w * b.y - self.x * b.z + self.y * b.w + self.z * b.x,
            z: self.w * b.z + self.x * b.y - self.y * b.x + self.z * b.w,
        }
    }
    fn rotate(self, v: Vec3d) -> Vec3d {
        let q = Self {
            w: 0.0,
            x: v.x,
            y: v.y,
            z: v.z,
        };
        let rotated = self.mul(q).mul(self.conjugate());
        Vec3d {
            x: rotated.x,
            y: rotated.y,
            z: rotated.z,
        }
    }
}

/// Maps source-frame coordinates into target-frame coordinates:
/// p_target = rotation * p_source + translation_m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidTransform {
    pub translation_m: Vec3d,
    pub rotation: Quatd,
}
impl RigidTransform {
    pub const IDENTITY: Self = Self {
        translation_m: Vec3d::ZERO,
        rotation: Quatd::IDENTITY,
    };
    pub fn new(translation_m: Vec3d, rotation: Quatd) -> Result<Self, SpatialError> {
        if !translation_m.finite() {
            return Err(SpatialError::InvalidTransform);
        }
        Ok(Self {
            translation_m,
            rotation: rotation.normalized()?,
        })
    }
    pub fn apply(self, p: Vec3d) -> Vec3d {
        self.rotation.rotate(p).add(self.translation_m)
    }
    pub fn inverse(self) -> Self {
        let rotation = self.rotation.conjugate();
        Self {
            rotation,
            translation_m: rotation.rotate(self.translation_m.neg()),
        }
    }
    /// self after previous: A->B (previous), B->C (self), yields A->C.
    pub fn after(self, previous: Self) -> Self {
        Self {
            translation_m: self
                .rotation
                .rotate(previous.translation_m)
                .add(self.translation_m),
            rotation: self.rotation.mul(previous.rotation),
        }
    }
}

/// First derivative of a child frame relative to its parent, expressed in the parent.
/// A provider without this capability must return `None`, never an assumed zero.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameDerivative {
    pub linear_velocity_m_s: Vec3d,
    pub angular_velocity_rad_s: Vec3d,
}
impl FrameDerivative {
    pub const ZERO: Self = Self {
        linear_velocity_m_s: Vec3d::ZERO,
        angular_velocity_rad_s: Vec3d::ZERO,
    };
    fn finite(self) -> bool {
        self.linear_velocity_m_s.finite() && self.angular_velocity_rad_s.finite()
    }
}
/// Position and first derivative of one frame expressed in another frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameState {
    pub transform: RigidTransform,
    pub derivative: FrameDerivative,
}
impl FrameState {
    const IDENTITY: Self = Self {
        transform: RigidTransform::IDENTITY,
        derivative: FrameDerivative::ZERO,
    };
    /// Velocity in the target frame of a point fixed in the source frame.
    pub fn point_velocity(&self, source_point_m: Vec3d) -> Vec3d {
        let offset = self.transform.rotation.rotate(source_point_m);
        self.derivative
            .linear_velocity_m_s
            .add(self.derivative.angular_velocity_rad_s.cross(offset))
    }
}

/// A transform is only valid at its explicitly declared instant.
/// Static samples are not interpolated; dynamic providers are evaluated separately.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameSample {
    pub instant: TimeInstant,
    pub to_parent: RigidTransform,
}
#[derive(Clone, Debug)]
enum FrameSource {
    Root,
    Sample(FrameSample),
    Dynamic(ProviderRef),
    /// Host-evaluated frame. The host supplies the transform for one instant; the
    /// core never interpolates or computes a trajectory.
    ProviderSample {
        provider_id: String,
        version: String,
        sample: Option<FrameSample>,
    },
    Unavailable {
        provider_id: String,
        version: String,
    },
}
#[derive(Clone, Debug)]
struct FrameNode {
    parent: Option<FrameId>,
    source: FrameSource,
}
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct ResolveKey {
    source: FrameId,
    target: FrameId,
    scale: String,
    epoch: String,
    seconds: i64,
    nanos: u32,
}
#[derive(Clone, Debug, Default)]
struct ResolveCache {
    revision: u64,
    entries: HashMap<ResolveKey, RigidTransform>,
}
const MAX_RESOLVE_CACHE: usize = 256;

/// Stable project data, never an internal graph handle.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameRecord {
    pub id: FrameId,
    pub parent: Option<FrameId>,
    pub sample: Option<FrameSample>,
    pub provider: Option<(String, String)>,
}
#[derive(Clone, Debug, Default)]
pub struct ReferenceFrameGraph {
    nodes: HashMap<FrameId, FrameNode>,
    revision: u64,
    // Bounded memo of pure provider resolutions, cleared whenever the graph changes.
    cache: RefCell<ResolveCache>,
}
impl ReferenceFrameGraph {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn records(&self) -> Vec<FrameRecord> {
        let mut records: Vec<_> = self
            .nodes
            .iter()
            .map(|(id, node)| FrameRecord {
                id: id.clone(),
                parent: node.parent.clone(),
                sample: match &node.source {
                    FrameSource::Sample(s) => Some(s.clone()),
                    _ => None,
                },
                provider: match &node.source {
                    FrameSource::Dynamic(p) => {
                        Some((p.provider_id().to_owned(), p.version().to_owned()))
                    }
                    FrameSource::ProviderSample {
                        provider_id,
                        version,
                        ..
                    } => Some((provider_id.clone(), version.clone())),
                    FrameSource::Unavailable {
                        provider_id,
                        version,
                    } => Some((provider_id.clone(), version.clone())),
                    _ => None,
                },
            })
            .collect();
        records.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        records
    }
    pub fn restore(
        records: &[FrameRecord],
        providers: &[ProviderRef],
    ) -> Result<Self, SpatialError> {
        let mut graph = Self::new();
        let mut pending = records.to_vec();
        while !pending.is_empty() {
            let before = pending.len();
            let mut next = Vec::new();
            for record in pending {
                if record.parent.as_ref().is_some_and(|id| !graph.contains(id)) {
                    next.push(record);
                    continue;
                }
                match (record.parent, record.sample, record.provider) {
                    (None, None, None) => {
                        graph.register_root(record.id)?;
                    }
                    (Some(parent), Some(sample), None) => {
                        graph.register_child(record.id, parent, sample)?;
                    }
                    (Some(parent), None, Some((provider_id, version))) => {
                        if let Some(provider) = providers
                            .iter()
                            .find(|p| p.provider_id() == provider_id && p.version() == version)
                        {
                            graph.register_dynamic_child(record.id, parent, provider.clone())?;
                        } else {
                            if provider_id.trim().is_empty() || version.trim().is_empty() {
                                return Err(SpatialError::InvalidProvider);
                            }
                            if graph.contains(&record.id) {
                                return Err(SpatialError::DuplicateFrame);
                            }
                            let revision = graph
                                .revision
                                .checked_add(1)
                                .ok_or(SpatialError::RevisionOverflow)?;
                            graph.nodes.insert(
                                record.id,
                                FrameNode {
                                    parent: Some(parent),
                                    source: FrameSource::Unavailable {
                                        provider_id,
                                        version,
                                    },
                                },
                            );
                            graph.revision = revision;
                        }
                    }
                    _ => return Err(SpatialError::InvalidParent),
                }
            }
            if next.len() == before {
                return Err(SpatialError::InvalidParent);
            }
            pending = next;
        }
        Ok(graph)
    }
    pub fn revision(&self) -> Revision {
        Revision(self.revision)
    }
    pub fn contains(&self, id: &FrameId) -> bool {
        self.nodes.contains_key(id)
    }
    pub fn register_root(&mut self, id: FrameId) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) {
            return Err(SpatialError::DuplicateFrame);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.insert(
            id,
            FrameNode {
                parent: None,
                source: FrameSource::Root,
            },
        );
        self.revision = next;
        Ok(self.revision())
    }
    pub fn register_child(
        &mut self,
        id: FrameId,
        parent: FrameId,
        mut sample: FrameSample,
    ) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) {
            return Err(SpatialError::DuplicateFrame);
        }
        if id == parent || !self.nodes.contains_key(&parent) {
            return Err(SpatialError::InvalidParent);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        // Revalidate even if constructed by external data or a future provider.
        let t = sample.to_parent;
        sample.to_parent = RigidTransform::new(t.translation_m, t.rotation)?;
        self.nodes.insert(
            id,
            FrameNode {
                parent: Some(parent),
                source: FrameSource::Sample(sample),
            },
        );
        self.revision = next;
        Ok(self.revision())
    }
    /// Register a dynamic child frame with a provider that accepts an explicit time.
    /// Providers are invoked on demand; no hidden cache or implicit interpolation.
    pub fn register_dynamic_child(
        &mut self,
        id: FrameId,
        parent: FrameId,
        provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) {
            return Err(SpatialError::DuplicateFrame);
        }
        if id == parent || !self.nodes.contains_key(&parent) {
            return Err(SpatialError::InvalidParent);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.insert(
            id,
            FrameNode {
                parent: Some(parent),
                source: FrameSource::Dynamic(provider),
            },
        );
        self.revision = next;
        Ok(self.revision())
    }
    /// Register a provider sample frame. The frame has no transform until the
    /// host supplies one for a concrete instant.
    pub fn register_provider_child(
        &mut self,
        id: FrameId,
        parent: FrameId,
        provider_id: String,
        version: String,
    ) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) {
            return Err(SpatialError::DuplicateFrame);
        }
        if id == parent || !self.nodes.contains_key(&parent) {
            return Err(SpatialError::InvalidParent);
        }
        if provider_id.trim().is_empty() || version.trim().is_empty() {
            return Err(SpatialError::InvalidProvider);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.insert(
            id,
            FrameNode {
                parent: Some(parent),
                source: FrameSource::ProviderSample {
                    provider_id,
                    version,
                    sample: None,
                },
            },
        );
        self.revision = next;
        Ok(self.revision())
    }
    /// Replace the provider sample for one instant. Only provider sample frames
    /// and restored unavailable placeholders can be updated; dynamic providers
    /// keep their own evaluation path.
    pub fn update_provider_sample(
        &mut self,
        id: &FrameId,
        mut sample: FrameSample,
    ) -> Result<Revision, SpatialError> {
        let t = sample.to_parent;
        sample.to_parent = RigidTransform::new(t.translation_m, t.rotation)?;
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let node = self.nodes.get_mut(id).ok_or(SpatialError::UnknownFrame)?;
        let replacement = match &mut node.source {
            FrameSource::ProviderSample { sample: slot, .. } => {
                *slot = Some(sample);
                None
            }
            FrameSource::Unavailable {
                provider_id,
                version,
            } => {
                let provider_id = std::mem::take(provider_id);
                let version = std::mem::take(version);
                Some(FrameSource::ProviderSample {
                    provider_id,
                    version,
                    sample: Some(sample),
                })
            }
            _ => return Err(SpatialError::InvalidProvider),
        };
        if let Some(source) = replacement {
            node.source = source;
        }
        self.revision = next;
        Ok(self.revision())
    }
    /// Invalidate a provider's results by replacing its binding, changing graph revision.
    pub fn replace_provider(
        &mut self,
        id: &FrameId,
        provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        let node = self.nodes.get(id).ok_or(SpatialError::UnknownFrame)?;
        if !matches!(&node.source, FrameSource::Dynamic(_)) {
            return Err(SpatialError::InvalidProvider);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.get_mut(id).expect("checked above").source = FrameSource::Dynamic(provider);
        self.revision = next;
        Ok(self.revision())
    }
    pub fn remove(&mut self, id: &FrameId) -> Result<Revision, SpatialError> {
        if !self.nodes.contains_key(id) {
            return Err(SpatialError::UnknownFrame);
        }
        if self
            .nodes
            .values()
            .any(|node| node.parent.as_ref() == Some(id))
        {
            return Err(SpatialError::FrameHasChildren);
        }
        let next = self
            .revision
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.remove(id);
        self.revision = next;
        Ok(self.revision())
    }
    fn ancestors(&self, start: &FrameId) -> Result<Vec<FrameId>, SpatialError> {
        let mut result = Vec::new();
        let mut seen = HashSet::new();
        let mut cursor = Some(start);
        while let Some(id) = cursor {
            if !seen.insert(id) {
                return Err(SpatialError::Cycle);
            }
            result.push(id.clone());
            cursor = self
                .nodes
                .get(id)
                .ok_or(SpatialError::UnknownFrame)?
                .parent
                .as_ref();
        }
        Ok(result)
    }
    fn to_ancestor(
        &self,
        start: &FrameId,
        ancestor: &FrameId,
        instant: &TimeInstant,
    ) -> Result<RigidTransform, SpatialError> {
        let mut cursor = start;
        let mut transform = RigidTransform::IDENTITY;
        while cursor != ancestor {
            let node = self.nodes.get(cursor).ok_or(SpatialError::UnknownFrame)?;
            let edge = match &node.source {
                FrameSource::Sample(sample) => {
                    if &sample.instant != instant {
                        return Err(SpatialError::TimeNotCovered);
                    }
                    sample.to_parent
                }
                FrameSource::Dynamic(provider) => provider.resolve_at(instant)?,
                FrameSource::ProviderSample { sample, .. } => {
                    let sample = sample.as_ref().ok_or(SpatialError::MissingTransform)?;
                    if &sample.instant != instant {
                        return Err(SpatialError::TimeNotCovered);
                    }
                    sample.to_parent
                }
                FrameSource::Root => return Err(SpatialError::Disconnected),
                FrameSource::Unavailable { .. } => return Err(SpatialError::MissingTransform),
            };
            let combined = edge.after(transform);
            transform = RigidTransform::new(combined.translation_m, combined.rotation)?;
            cursor = node.parent.as_ref().ok_or(SpatialError::Disconnected)?;
        }
        Ok(transform)
    }
    pub fn resolve(
        &self,
        source: &FrameId,
        target: &FrameId,
        instant: &TimeInstant,
    ) -> Result<RigidTransform, SpatialError> {
        let key = ResolveKey {
            source: source.clone(),
            target: target.clone(),
            scale: instant.scale().to_owned(),
            epoch: instant.epoch().to_owned(),
            seconds: instant.seconds(),
            nanos: instant.nanos(),
        };
        if let Some(cached) = self.cached(&key) {
            return Ok(cached);
        }
        let source_chain = self.ancestors(source)?;
        let target_chain = self.ancestors(target)?;
        let targets: HashSet<_> = target_chain.iter().collect();
        let ancestor = source_chain
            .iter()
            .find(|id| targets.contains(id))
            .ok_or(SpatialError::Disconnected)?;
        let source_to_common = self.to_ancestor(source, ancestor, instant)?;
        let target_to_common = self.to_ancestor(target, ancestor, instant)?;
        let result = target_to_common.inverse().after(source_to_common);
        let result = RigidTransform::new(result.translation_m, result.rotation)?;
        self.store(key, result);
        Ok(result)
    }
    /// Resolve positions and first derivatives in one consistent evaluation.
    /// Every crossed edge must supply an explicit derivative; missing data is an error,
    /// never an assumed zero velocity.
    pub fn resolve_state(
        &self,
        source: &FrameId,
        target: &FrameId,
        instant: &TimeInstant,
    ) -> Result<FrameState, SpatialError> {
        let source_chain = self.ancestors(source)?;
        let target_chain = self.ancestors(target)?;
        let targets: HashSet<_> = target_chain.iter().collect();
        let ancestor = source_chain
            .iter()
            .find(|id| targets.contains(id))
            .ok_or(SpatialError::Disconnected)?;
        let source_to_common = self.to_ancestor_state(source, ancestor, instant)?;
        let target_to_common = self.to_ancestor_state(target, ancestor, instant)?;
        compose_state(invert_state(target_to_common)?, source_to_common)
    }
    fn cached(&self, key: &ResolveKey) -> Option<RigidTransform> {
        let mut cache = self.cache.borrow_mut();
        if cache.revision != self.revision {
            cache.entries.clear();
            cache.revision = self.revision;
        }
        cache.entries.get(key).copied()
    }
    fn store(&self, key: ResolveKey, transform: RigidTransform) {
        let mut cache = self.cache.borrow_mut();
        if cache.revision != self.revision {
            cache.entries.clear();
            cache.revision = self.revision;
        }
        if cache.entries.len() >= MAX_RESOLVE_CACHE {
            cache.entries.clear();
        }
        cache.entries.insert(key, transform);
    }
    fn to_ancestor_state(
        &self,
        start: &FrameId,
        ancestor: &FrameId,
        instant: &TimeInstant,
    ) -> Result<FrameState, SpatialError> {
        let mut cursor = start;
        let mut state = FrameState::IDENTITY;
        while cursor != ancestor {
            let node = self.nodes.get(cursor).ok_or(SpatialError::UnknownFrame)?;
            let edge = match &node.source {
                FrameSource::Root => return Err(SpatialError::Disconnected),
                FrameSource::Sample(sample) => {
                    if &sample.instant != instant {
                        return Err(SpatialError::TimeNotCovered);
                    }
                    return Err(SpatialError::DerivativeUnavailable);
                }
                FrameSource::Dynamic(provider) => {
                    let transform = provider.resolve_at(instant)?;
                    let derivative = provider
                        .derivative_at(instant)?
                        .ok_or(SpatialError::DerivativeUnavailable)?;
                    FrameState {
                        transform,
                        derivative,
                    }
                }
                FrameSource::ProviderSample { sample, .. } => {
                    let sample = sample.as_ref().ok_or(SpatialError::MissingTransform)?;
                    if &sample.instant != instant {
                        return Err(SpatialError::TimeNotCovered);
                    }
                    return Err(SpatialError::DerivativeUnavailable);
                }
                FrameSource::Unavailable { .. } => return Err(SpatialError::MissingTransform),
            };
            state = compose_state(edge, state)?;
            cursor = node.parent.as_ref().ok_or(SpatialError::Disconnected)?;
        }
        Ok(state)
    }
}

fn compose_state(parent: FrameState, child: FrameState) -> Result<FrameState, SpatialError> {
    // parent: B->C, child: A->B, so the result is A->C.
    let transform = RigidTransform::new(
        parent
            .transform
            .rotation
            .rotate(child.transform.translation_m)
            .add(parent.transform.translation_m),
        parent.transform.rotation.mul(child.transform.rotation),
    )?;
    let rotated_translation = parent
        .transform
        .rotation
        .rotate(child.transform.translation_m);
    let derivative = FrameDerivative {
        linear_velocity_m_s: parent
            .transform
            .rotation
            .rotate(child.derivative.linear_velocity_m_s)
            .add(
                parent
                    .derivative
                    .angular_velocity_rad_s
                    .cross(rotated_translation),
            )
            .add(parent.derivative.linear_velocity_m_s),
        angular_velocity_rad_s: parent
            .transform
            .rotation
            .rotate(child.derivative.angular_velocity_rad_s)
            .add(parent.derivative.angular_velocity_rad_s),
    };
    if !derivative.finite() {
        return Err(SpatialError::InvalidTransform);
    }
    Ok(FrameState {
        transform,
        derivative,
    })
}
fn invert_state(state: FrameState) -> Result<FrameState, SpatialError> {
    let transform = state.transform.inverse();
    let derivative = FrameDerivative {
        linear_velocity_m_s: transform.rotation.rotate(
            state
                .derivative
                .angular_velocity_rad_s
                .cross(state.transform.translation_m)
                .sub(state.derivative.linear_velocity_m_s),
        ),
        angular_velocity_rad_s: transform
            .rotation
            .rotate(state.derivative.angular_velocity_rad_s.neg()),
    };
    if !derivative.finite() {
        return Err(SpatialError::InvalidTransform);
    }
    Ok(FrameState {
        transform,
        derivative,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[derive(Debug)]
    struct MovingProvider;
    impl TransformProvider for MovingProvider {
        fn provider_id(&self) -> &str {
            "example.moving"
        }
        fn version(&self) -> &str {
            "1"
        }
        fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
            if instant.scale() != "TT" || instant.epoch() != "epoch" {
                return Err(SpatialError::TimeNotCovered);
            }
            RigidTransform::new(
                Vec3d {
                    x: instant.seconds() as f64,
                    y: 0.0,
                    z: 0.0,
                },
                Quatd::IDENTITY,
            )
        }
    }
    #[test]
    fn dynamic_provider_uses_requested_instant() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        let provider = ProviderRef::new(Arc::new(MovingProvider)).unwrap();
        graph
            .register_dynamic_child(id("moving"), id("root"), provider)
            .unwrap();
        let t0 = at();
        let t1 = TimeInstant::new("TT", "epoch", 10, 0).unwrap();
        assert_eq!(
            graph
                .resolve(&id("moving"), &id("root"), &t0)
                .unwrap()
                .translation_m
                .x,
            0.0
        );
        assert_eq!(
            graph
                .resolve(&id("moving"), &id("root"), &t1)
                .unwrap()
                .translation_m
                .x,
            10.0
        );
        assert_eq!(graph.revision(), Revision(2));
    }
    fn id(s: &str) -> FrameId {
        FrameId::new(s).unwrap()
    }
    fn at() -> TimeInstant {
        TimeInstant::new("TT", "epoch", 0, 0).unwrap()
    }
    fn translation(x: f64, y: f64, z: f64) -> RigidTransform {
        RigidTransform::new(Vec3d { x, y, z }, Quatd::IDENTITY).unwrap()
    }
    fn near(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }
    #[test]
    fn chain_and_inverse() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph
            .register_child(
                id("earth"),
                id("root"),
                FrameSample {
                    instant: at(),
                    to_parent: translation(10.0, 0.0, 0.0),
                },
            )
            .unwrap();
        graph
            .register_child(
                id("moon"),
                id("earth"),
                FrameSample {
                    instant: at(),
                    to_parent: translation(2.0, 0.0, 0.0),
                },
            )
            .unwrap();
        near(
            graph
                .resolve(&id("moon"), &id("root"), &at())
                .unwrap()
                .apply(Vec3d::ZERO)
                .x,
            12.0,
        );
        near(
            graph
                .resolve(&id("root"), &id("moon"), &at())
                .unwrap()
                .apply(Vec3d::ZERO)
                .x,
            -12.0,
        );
    }
    #[test]
    fn rejects_invalid_parent_duplicate_and_child_removal() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        assert_eq!(
            graph.register_child(
                id("bad"),
                id("missing"),
                FrameSample {
                    instant: at(),
                    to_parent: RigidTransform::IDENTITY
                }
            ),
            Err(SpatialError::InvalidParent)
        );
        graph
            .register_child(
                id("child"),
                id("root"),
                FrameSample {
                    instant: at(),
                    to_parent: RigidTransform::IDENTITY,
                },
            )
            .unwrap();
        assert_eq!(
            graph.remove(&id("root")),
            Err(SpatialError::FrameHasChildren)
        );
        assert_eq!(
            graph.register_root(id("root")),
            Err(SpatialError::DuplicateFrame)
        );
        assert_eq!(graph.revision(), Revision(2));
    }
    #[test]
    fn requires_explicit_sample_instant() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph
            .register_child(
                id("child"),
                id("root"),
                FrameSample {
                    instant: at(),
                    to_parent: RigidTransform::IDENTITY,
                },
            )
            .unwrap();
        let later = TimeInstant::new("TT", "epoch", 1, 0).unwrap();
        assert_eq!(
            graph.resolve(&id("child"), &id("root"), &later),
            Err(SpatialError::TimeNotCovered)
        );
    }
    #[test]
    fn rotation_composition_is_not_commutative() {
        let half = std::f64::consts::FRAC_1_SQRT_2;
        let qz = Quatd {
            w: half,
            x: 0.0,
            y: 0.0,
            z: half,
        };
        let qx = Quatd {
            w: half,
            x: half,
            y: 0.0,
            z: 0.0,
        };
        let z = RigidTransform::new(Vec3d::ZERO, qz).unwrap();
        let x = RigidTransform::new(Vec3d::ZERO, qx).unwrap();
        let p = Vec3d {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        };
        let a = x.after(z).apply(p);
        let b = z.after(x).apply(p);
        assert!((a.y - b.y).abs() > 0.5 || (a.z - b.z).abs() > 0.5);
    }
    #[test]
    fn disconnected_roots_are_not_implicitly_connected() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("a")).unwrap();
        graph.register_root(id("b")).unwrap();
        assert_eq!(
            graph.resolve(&id("a"), &id("b"), &at()),
            Err(SpatialError::Disconnected)
        );
    }
    #[test]
    fn provider_sample_frame_requires_an_updated_single_instant_sample() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph
            .register_provider_child(
                id("earth"),
                id("root"),
                "spaceeyes.nasa.dynamo".into(),
                "0.0.1".into(),
            )
            .unwrap();
        assert_eq!(
            graph.resolve(&id("earth"), &id("root"), &at()),
            Err(SpatialError::MissingTransform)
        );
        let revision = graph
            .update_provider_sample(
                &id("earth"),
                FrameSample {
                    instant: at(),
                    to_parent: translation(3.0, 4.0, 0.0),
                },
            )
            .unwrap();
        assert_eq!(revision, Revision(3));
        let position = graph
            .resolve(&id("earth"), &id("root"), &at())
            .unwrap()
            .apply(Vec3d::ZERO);
        near(position.x, 3.0);
        near(position.y, 4.0);
        let later = TimeInstant::new("TT", "epoch", 1, 0).unwrap();
        assert_eq!(
            graph.resolve(&id("earth"), &id("root"), &later),
            Err(SpatialError::TimeNotCovered)
        );
        assert_eq!(
            graph.update_provider_sample(
                &id("root"),
                FrameSample {
                    instant: at(),
                    to_parent: RigidTransform::IDENTITY,
                },
            ),
            Err(SpatialError::InvalidProvider)
        );
        assert_eq!(
            graph.update_provider_sample(
                &id("missing"),
                FrameSample {
                    instant: at(),
                    to_parent: RigidTransform::IDENTITY,
                },
            ),
            Err(SpatialError::UnknownFrame)
        );
    }
    #[test]
    fn restored_missing_provider_can_be_rebound_by_a_provider_sample() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph
            .register_provider_child(
                id("earth"),
                id("root"),
                "spaceeyes.nasa.dynamo".into(),
                "0.0.1".into(),
            )
            .unwrap();
        graph
            .update_provider_sample(
                &id("earth"),
                FrameSample {
                    instant: at(),
                    to_parent: translation(1.0, 0.0, 0.0),
                },
            )
            .unwrap();
        let records = graph.records();
        let mut restored = ReferenceFrameGraph::restore(&records, &[]).unwrap();
        let record = restored
            .records()
            .into_iter()
            .find(|r| r.id == id("earth"))
            .unwrap();
        assert_eq!(
            record.provider,
            Some(("spaceeyes.nasa.dynamo".into(), "0.0.1".into()))
        );
        assert_eq!(
            restored.resolve(&id("earth"), &id("root"), &at()),
            Err(SpatialError::MissingTransform)
        );
        restored
            .update_provider_sample(
                &id("earth"),
                FrameSample {
                    instant: at(),
                    to_parent: translation(7.0, 0.0, 0.0),
                },
            )
            .expect("restored placeholder accepts provider samples");
        let position = restored
            .resolve(&id("earth"), &id("root"), &at())
            .unwrap()
            .apply(Vec3d::ZERO);
        near(position.x, 7.0);
    }
}
