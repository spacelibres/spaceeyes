//! Generic reference-frame graph with time-explicit rigid transforms.
//! No NASA data, ephemeris computation, or implicit system clock.
use std::collections::{HashMap, HashSet};
use spaceeyes_foundation::{FrameId, Revision};
use spaceeyes_time::TimeInstant;

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
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3d { pub x: f64, pub y: f64, pub z: f64 }
impl Vec3d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0, z: 0.0 };
    fn finite(self) -> bool { self.x.is_finite() && self.y.is_finite() && self.z.is_finite() }
    fn add(self, rhs: Self) -> Self {
        Self { x: self.x + rhs.x, y: self.y + rhs.y, z: self.z + rhs.z }
    }
    fn neg(self) -> Self { Self { x: -self.x, y: -self.y, z: -self.z } }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quatd { pub w: f64, pub x: f64, pub y: f64, pub z: f64 }
impl Quatd {
    pub const IDENTITY: Self = Self { w: 1.0, x: 0.0, y: 0.0, z: 0.0 };
    fn finite(self) -> bool {
        [self.w, self.x, self.y, self.z].iter().all(|v| v.is_finite())
    }
    fn norm_squared(self) -> f64 {
        self.w*self.w + self.x*self.x + self.y*self.y + self.z*self.z
    }
    fn normalized(self) -> Result<Self, SpatialError> {
        if !self.finite() { return Err(SpatialError::InvalidTransform); }
        let norm = self.norm_squared().sqrt();
        if !norm.is_finite() || norm <= 1e-12 { return Err(SpatialError::InvalidTransform); }
        Ok(Self { w:self.w/norm, x:self.x/norm, y:self.y/norm, z:self.z/norm })
    }
    fn conjugate(self) -> Self {
        Self { w:self.w, x:-self.x, y:-self.y, z:-self.z }
    }
    fn mul(self, b: Self) -> Self {
        Self {
            w:self.w*b.w-self.x*b.x-self.y*b.y-self.z*b.z,
            x:self.w*b.x+self.x*b.w+self.y*b.z-self.z*b.y,
            y:self.w*b.y-self.x*b.z+self.y*b.w+self.z*b.x,
            z:self.w*b.z+self.x*b.y-self.y*b.x+self.z*b.w,
        }
    }
    fn rotate(self, v: Vec3d) -> Vec3d {
        let q = Self { w:0.0, x:v.x, y:v.y, z:v.z };
        let rotated = self.mul(q).mul(self.conjugate());
        Vec3d { x:rotated.x, y:rotated.y, z:rotated.z }
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
    pub const IDENTITY: Self = Self { translation_m:Vec3d::ZERO, rotation:Quatd::IDENTITY };
    pub fn new(translation_m: Vec3d, rotation: Quatd) -> Result<Self, SpatialError> {
        if !translation_m.finite() { return Err(SpatialError::InvalidTransform); }
        Ok(Self { translation_m, rotation:rotation.normalized()? })
    }
    pub fn apply(self, p: Vec3d) -> Vec3d { self.rotation.rotate(p).add(self.translation_m) }
    pub fn inverse(self) -> Self {
        let rotation = self.rotation.conjugate();
        Self { rotation, translation_m:rotation.rotate(self.translation_m.neg()) }
    }
    /// self after previous: A->B (previous), B->C (self), yields A->C.
    pub fn after(self, previous: Self) -> Self {
        Self {
            translation_m:self.rotation.rotate(previous.translation_m).add(self.translation_m),
            rotation:self.rotation.mul(previous.rotation),
        }
    }
}

/// A transform is only valid at its explicitly declared instant.
/// Time interpolation and dynamic providers are deliberately not implemented.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameSample {
    pub instant: TimeInstant,
    pub to_parent: RigidTransform,
}
#[derive(Clone, Debug)]
struct FrameNode {
    parent: Option<FrameId>,
    sample: Option<FrameSample>,
}
#[derive(Clone, Debug, Default)]
pub struct ReferenceFrameGraph {
    nodes: HashMap<FrameId, FrameNode>,
    revision: u64,
}
impl ReferenceFrameGraph {
    pub fn new() -> Self { Self::default() }
    pub fn revision(&self) -> Revision { Revision(self.revision) }
    pub fn contains(&self, id: &FrameId) -> bool { self.nodes.contains_key(id) }
    pub fn register_root(&mut self, id: FrameId) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) { return Err(SpatialError::DuplicateFrame); }
        let next = self.revision.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.insert(id, FrameNode { parent:None, sample:None });
        self.revision = next;
        Ok(self.revision())
    }
    pub fn register_child(&mut self, id: FrameId, parent: FrameId, sample: FrameSample) -> Result<Revision, SpatialError> {
        if self.nodes.contains_key(&id) { return Err(SpatialError::DuplicateFrame); }
        if id == parent || !self.nodes.contains_key(&parent) { return Err(SpatialError::InvalidParent); }
        let next = self.revision.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        // Revalidate even if constructed by external data or a future provider.
        let t = sample.to_parent;
        RigidTransform::new(t.translation_m, t.rotation)?;
        self.nodes.insert(id, FrameNode { parent:Some(parent), sample:Some(sample) });
        self.revision = next;
        Ok(self.revision())
    }
    pub fn remove(&mut self, id: &FrameId) -> Result<Revision, SpatialError> {
        if !self.nodes.contains_key(id) { return Err(SpatialError::UnknownFrame); }
        if self.nodes.values().any(|node| node.parent.as_ref() == Some(id)) {
            return Err(SpatialError::FrameHasChildren);
        }
        let next = self.revision.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        self.nodes.remove(id);
        self.revision = next;
        Ok(self.revision())
    }
    fn to_root(&self, start: &FrameId, instant: &TimeInstant) -> Result<(FrameId,RigidTransform),SpatialError> {
        let mut cursor = start.clone();
        let mut transform = RigidTransform::IDENTITY;
        let mut seen = HashSet::new();
        loop {
            if !seen.insert(cursor.clone()) { return Err(SpatialError::Cycle); }
            let node = self.nodes.get(&cursor).ok_or(SpatialError::UnknownFrame)?;
            match (&node.parent, &node.sample) {
                (None,None) => return Ok((cursor,transform)),
                (Some(parent),Some(sample)) => {
                    if &sample.instant != instant { return Err(SpatialError::TimeNotCovered); }
                    transform = sample.to_parent.after(transform);
                    cursor = parent.clone();
                }
                _ => return Err(SpatialError::MissingTransform),
            }
        }
    }
    pub fn resolve(&self, source: &FrameId, target: &FrameId, instant: &TimeInstant) -> Result<RigidTransform,SpatialError> {
        if !self.contains(source) || !self.contains(target) { return Err(SpatialError::UnknownFrame); }
        if source == target { return Ok(RigidTransform::IDENTITY); }
        let (source_root, source_to_root) = self.to_root(source, instant)?;
        let (target_root, target_to_root) = self.to_root(target, instant)?;
        if source_root != target_root { return Err(SpatialError::Disconnected); }
        Ok(target_to_root.inverse().after(source_to_root))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(s:&str)->FrameId { FrameId::new(s).unwrap() }
    fn at()->TimeInstant { TimeInstant::new("TT","epoch",0,0).unwrap() }
    fn translation(x:f64,y:f64,z:f64)->RigidTransform {
        RigidTransform::new(Vec3d{x,y,z},Quatd::IDENTITY).unwrap()
    }
    fn near(a:f64,b:f64) { assert!((a-b).abs()<1e-9, "{a} != {b}"); }
    #[test]
    fn chain_and_inverse() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph.register_child(id("earth"),id("root"),FrameSample{instant:at(),to_parent:translation(10.0,0.0,0.0)}).unwrap();
        graph.register_child(id("moon"),id("earth"),FrameSample{instant:at(),to_parent:translation(2.0,0.0,0.0)}).unwrap();
        near(graph.resolve(&id("moon"),&id("root"),&at()).unwrap().apply(Vec3d::ZERO).x,12.0);
        near(graph.resolve(&id("root"),&id("moon"),&at()).unwrap().apply(Vec3d::ZERO).x,-12.0);
    }
    #[test]
    fn rejects_invalid_parent_duplicate_and_child_removal() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        assert_eq!(graph.register_child(id("bad"),id("missing"),FrameSample{instant:at(),to_parent:RigidTransform::IDENTITY}),Err(SpatialError::InvalidParent));
        graph.register_child(id("child"),id("root"),FrameSample{instant:at(),to_parent:RigidTransform::IDENTITY}).unwrap();
        assert_eq!(graph.remove(&id("root")),Err(SpatialError::FrameHasChildren));
        assert_eq!(graph.register_root(id("root")),Err(SpatialError::DuplicateFrame));
        assert_eq!(graph.revision(),Revision(2));
    }
    #[test]
    fn requires_explicit_sample_instant() {
        let mut graph = ReferenceFrameGraph::new();
        graph.register_root(id("root")).unwrap();
        graph.register_child(id("child"),id("root"),FrameSample{instant:at(),to_parent:RigidTransform::IDENTITY}).unwrap();
        let later=TimeInstant::new("TT","epoch",1,0).unwrap();
        assert_eq!(graph.resolve(&id("child"),&id("root"),&later),Err(SpatialError::TimeNotCovered));
    }
    #[test]
    fn rotation_composition_is_not_commutative() {
        let half=std::f64::consts::FRAC_1_SQRT_2;
        let qz=Quatd{w:half,x:0.0,y:0.0,z:half};
        let qx=Quatd{w:half,x:half,y:0.0,z:0.0};
        let z=RigidTransform::new(Vec3d::ZERO,qz).unwrap();
        let x=RigidTransform::new(Vec3d::ZERO,qx).unwrap();
        let p=Vec3d{x:1.0,y:0.0,z:0.0};
        let a=x.after(z).apply(p);
        let b=z.after(x).apply(p);
        assert!((a.y-b.y).abs()>0.5 || (a.z-b.z).abs()>0.5);
    }
    #[test]
    fn disconnected_roots_are_not_implicitly_connected() {
        let mut graph=ReferenceFrameGraph::new();
        graph.register_root(id("a")).unwrap();
        graph.register_root(id("b")).unwrap();
        assert_eq!(graph.resolve(&id("a"),&id("b"),&at()),Err(SpatialError::Disconnected));
    }
}
