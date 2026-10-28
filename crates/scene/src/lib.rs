// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Authoritative scene registry and atomic command transactions.
//! ParentId is organizational; FrameId is an independent spatial reference.
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, ResourceId, Revision};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
mod camera;
pub use camera::{CameraProjection, CameraState, CameraTracking};
mod sphere;
pub use sphere::Sphere;
mod mesh;
pub use mesh::MeshInstance;
mod material;
pub use material::Material;
static NEXT_REGISTRY: AtomicU64 = AtomicU64::new(1);
pub const MAX_LINE_POINTS: usize = 4096;

/// Polyline in the object's local frame. Lines are solid-colour and unlit;
/// they do not participate in picking (a line has no pickable surface).
#[derive(Clone, Debug, PartialEq)]
pub struct LinePrimitive {
    points_m: Vec<[f64; 3]>,
    color: [f32; 3],
}
impl Eq for LinePrimitive {}
impl LinePrimitive {
    pub fn new(points_m: Vec<[f64; 3]>, color: [f32; 3]) -> Result<Self, CoreError> {
        if !(2..=MAX_LINE_POINTS).contains(&points_m.len())
            || !points_m.iter().flatten().all(|value| value.is_finite())
            || !color.iter().all(|value| value.is_finite())
        {
            return Err(CoreError::InvalidState);
        }
        Ok(Self { points_m, color })
    }
    pub fn points_m(&self) -> &[[f64; 3]] {
        &self.points_m
    }
    pub fn color(&self) -> [f32; 3] {
        self.color
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ObjectHandle {
    registry: u64,
    object: ObjectId,
    generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneObject {
    id: ObjectId,
    parent: Option<ObjectId>,
    frame: Option<FrameId>,
    visible: bool,
    resources: Vec<ResourceId>,
    camera: Option<CameraState>,
    sphere: Option<Sphere>,
    mesh: Option<MeshInstance>,
    line: Option<LinePrimitive>,
}
impl SceneObject {
    pub fn new(id: ObjectId) -> Self {
        Self {
            id,
            parent: None,
            frame: None,
            visible: true,
            resources: Vec::new(),
            camera: None,
            sphere: None,
            mesh: None,
            line: None,
        }
    }
    pub fn id(&self) -> &ObjectId {
        &self.id
    }
    pub fn parent(&self) -> Option<&ObjectId> {
        self.parent.as_ref()
    }
    pub fn frame(&self) -> Option<&FrameId> {
        self.frame.as_ref()
    }
    pub fn resources(&self) -> &[ResourceId] {
        &self.resources
    }
    pub fn mesh(&self) -> Option<&MeshInstance> {
        self.mesh.as_ref()
    }
    pub fn resource_refs(&self) -> Vec<&ResourceId> {
        let mut refs: Vec<_> = self.resources.iter().collect();
        if let Some(mesh) = &self.mesh {
            if !refs.contains(&mesh.geometry()) {
                refs.push(mesh.geometry());
            }
        }
        let texture = self
            .mesh
            .as_ref()
            .and_then(|m| m.material().texture())
            .or_else(|| self.sphere.as_ref().and_then(|s| s.material().texture()));
        if let Some(texture) = texture {
            if !refs.contains(&texture) {
                refs.push(texture);
            }
        }
        refs
    }
    pub fn material(&self) -> Option<&Material> {
        self.mesh
            .as_ref()
            .map(|m| m.material())
            .or_else(|| self.sphere.as_ref().map(|s| s.material()))
    }
    pub fn sphere(&self) -> Option<&Sphere> {
        self.sphere.as_ref()
    }
    pub fn camera(&self) -> Option<&CameraState> {
        self.camera.as_ref()
    }
    pub fn line(&self) -> Option<&LinePrimitive> {
        self.line.as_ref()
    }
    pub fn visible(&self) -> bool {
        self.visible
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SceneCommand {
    SetMesh {
        object: ObjectId,
        mesh: Option<MeshInstance>,
    },
    SetSphere {
        object: ObjectId,
        sphere: Option<Sphere>,
    },
    SetCamera {
        object: ObjectId,
        camera: Option<CameraState>,
    },
    SetLine {
        object: ObjectId,
        line: Option<LinePrimitive>,
    },
    SetResources {
        object: ObjectId,
        resources: Vec<ResourceId>,
    },
    Create(SceneObject),
    SetParent {
        object: ObjectId,
        parent: Option<ObjectId>,
    },
    SetFrame {
        object: ObjectId,
        frame: Option<FrameId>,
    },
    SetVisibility {
        object: ObjectId,
        visible: bool,
    },
    Delete {
        object: ObjectId,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneSnapshot {
    pub revision: Revision,
    pub objects: Vec<SceneObject>,
}

#[derive(Clone)]
pub struct Scene {
    registry: u64,
    generations: HashMap<ObjectId, u64>,
    objects: HashMap<ObjectId, SceneObject>,
    revision: u64,
}
impl Default for Scene {
    fn default() -> Self {
        let registry = NEXT_REGISTRY
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
            .expect("scene registry identity exhausted");
        Self {
            registry,
            objects: HashMap::new(),
            generations: HashMap::new(),
            revision: 0,
        }
    }
}
impl Scene {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn handle(&self, id: &ObjectId) -> Option<ObjectHandle> {
        self.objects.get(id)?;
        Some(ObjectHandle {
            registry: self.registry,
            object: id.clone(),
            generation: *self.generations.get(id)?,
        })
    }
    pub fn get_by_handle(&self, handle: &ObjectHandle) -> Result<&SceneObject, CoreError> {
        if handle.registry != self.registry
            || self.generations.get(&handle.object) != Some(&handle.generation)
        {
            return Err(CoreError::InvalidHandle);
        }
        self.objects
            .get(&handle.object)
            .ok_or(CoreError::InvalidHandle)
    }
    pub fn revision(&self) -> Revision {
        Revision(self.revision)
    }
    pub fn get(&self, id: &ObjectId) -> Option<&SceneObject> {
        self.objects.get(id)
    }
    pub fn len(&self) -> usize {
        self.objects.len()
    }
    pub fn is_empty(&self) -> bool {
        self.objects.is_empty()
    }
    pub fn snapshot(&self) -> SceneSnapshot {
        let mut objects: Vec<_> = self.objects.values().cloned().collect();
        objects.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        SceneSnapshot {
            revision: self.revision(),
            objects,
        }
    }
    /// Atomically apply all commands; no mutation if any command fails.
    pub fn apply_transaction(
        &mut self,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CoreError> {
        if self.revision() != expected_revision {
            return Err(CoreError::RevisionConflict);
        }
        if commands.is_empty() {
            return Ok(self.revision());
        }
        let next_revision = self
            .revision
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        let mut generations = self.generations.clone();
        let mut proposed = self.objects.clone();
        for command in commands {
            match command {
                SceneCommand::SetMesh { object, mesh } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .mesh = mesh.clone();
                }
                SceneCommand::SetSphere { object, sphere } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .sphere = sphere.clone();
                }
                SceneCommand::SetCamera { object, camera } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .camera = camera.clone();
                }
                SceneCommand::SetLine { object, line } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .line = line.clone();
                }
                SceneCommand::SetResources { object, resources } => {
                    let mut unique = resources.clone();
                    unique.sort_by(|a, b| a.as_str().cmp(b.as_str()));
                    unique.dedup();
                    if unique.len() != resources.len() {
                        return Err(CoreError::InvalidState);
                    }
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .resources = unique;
                }
                SceneCommand::Create(obj) => {
                    if proposed.contains_key(obj.id()) {
                        return Err(CoreError::DuplicateObject);
                    }
                    let generation = generations
                        .get(obj.id())
                        .copied()
                        .unwrap_or(0)
                        .checked_add(1)
                        .ok_or(CoreError::InvalidState)?;
                    generations.insert(obj.id.clone(), generation);
                    proposed.insert(obj.id.clone(), obj.clone());
                }
                SceneCommand::SetParent { object, parent } => {
                    if let Some(p) = parent {
                        if !proposed.contains_key(p) {
                            return Err(CoreError::ParentNotFound);
                        }
                        let mut cursor = Some(p);
                        let mut remaining = proposed.len();
                        while let Some(id) = cursor {
                            if id == object {
                                return Err(CoreError::HierarchyCycle);
                            }
                            if remaining == 0 {
                                return Err(CoreError::HierarchyCycle);
                            }
                            remaining -= 1;
                            cursor = proposed.get(id).and_then(|entry| entry.parent.as_ref());
                        }
                    }
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .parent = parent.clone();
                }
                SceneCommand::SetFrame { object, frame } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .frame = frame.clone();
                }
                SceneCommand::SetVisibility { object, visible } => {
                    proposed
                        .get_mut(object)
                        .ok_or(CoreError::UnknownObject)?
                        .visible = *visible;
                }
                SceneCommand::Delete { object } => {
                    if !proposed.contains_key(object) {
                        return Err(CoreError::UnknownObject);
                    }
                    if proposed
                        .values()
                        .any(|entry| entry.parent.as_ref() == Some(object))
                    {
                        return Err(CoreError::HasChildren);
                    }
                    proposed.remove(object);
                }
            }
        }
        // Create may contain a cloned object's relationships; validate those too.
        for object in proposed.values() {
            if let Some(tracking) = object.camera().and_then(CameraState::tracking) {
                let target = proposed
                    .get(tracking.target())
                    .ok_or(CoreError::UnknownObject)?;
                if target.id() == object.id() || target.camera().is_some() {
                    return Err(CoreError::InvalidState);
                }
                if target.frame().is_none() {
                    return Err(CoreError::UnknownFrame);
                }
                // A delete/recreate under the same ID must not silently transfer tracking.
                if generations.get(target.id()) != self.generations.get(target.id())
                    && self
                        .objects
                        .get(object.id())
                        .and_then(SceneObject::camera)
                        .and_then(CameraState::tracking)
                        .is_some_and(|old| old.target() == tracking.target())
                {
                    return Err(CoreError::InvalidHandle);
                }
            }
            if usize::from(object.camera.is_some())
                + usize::from(object.sphere.is_some())
                + usize::from(object.mesh.is_some())
                > 1
            {
                return Err(CoreError::InvalidState);
            }
            let mut cursor = object.parent.as_ref();
            let mut remaining = proposed.len();
            while let Some(id) = cursor {
                if remaining == 0 || id == object.id() {
                    return Err(CoreError::HierarchyCycle);
                }
                remaining -= 1;
                cursor = proposed
                    .get(id)
                    .ok_or(CoreError::ParentNotFound)?
                    .parent
                    .as_ref();
            }
        }
        self.objects = proposed;
        self.generations = generations;
        self.revision = next_revision;
        Ok(self.revision())
    }
    /// Compatibility helper for initial bootstrap; later external writes use Engine.
    pub fn create(&mut self, object: SceneObject) -> Result<(), CoreError> {
        self.apply_transaction(self.revision(), &[SceneCommand::Create(object)])
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(value: &str) -> ObjectId {
        ObjectId::new(value).unwrap()
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let mut scene = Scene::new();
        scene.create(SceneObject::new(id("sun"))).unwrap();
        assert_eq!(
            scene.create(SceneObject::new(id("sun"))),
            Err(CoreError::DuplicateObject)
        );
        assert_eq!(scene.revision(), Revision(1));
    }
    #[test]
    fn transaction_rolls_back_on_error() {
        let mut scene = Scene::new();
        let result = scene.apply_transaction(
            Revision(0),
            &[
                SceneCommand::Create(SceneObject::new(id("earth"))),
                SceneCommand::Delete {
                    object: id("missing"),
                },
            ],
        );
        assert_eq!(result, Err(CoreError::UnknownObject));
        assert!(scene.is_empty());
        assert_eq!(scene.revision(), Revision(0));
    }
    #[test]
    fn rejects_cycles_and_parent_deletion() {
        let mut scene = Scene::new();
        scene
            .apply_transaction(
                Revision(0),
                &[
                    SceneCommand::Create(SceneObject::new(id("earth"))),
                    SceneCommand::Create(SceneObject::new(id("moon"))),
                    SceneCommand::SetParent {
                        object: id("moon"),
                        parent: Some(id("earth")),
                    },
                ],
            )
            .unwrap();
        assert_eq!(
            scene.apply_transaction(
                Revision(1),
                &[SceneCommand::SetParent {
                    object: id("earth"),
                    parent: Some(id("moon"))
                },]
            ),
            Err(CoreError::HierarchyCycle)
        );
        assert_eq!(
            scene.apply_transaction(
                Revision(1),
                &[SceneCommand::Delete {
                    object: id("earth")
                },]
            ),
            Err(CoreError::HasChildren)
        );
        assert_eq!(scene.revision(), Revision(1));
    }
    #[test]
    fn revision_conflict_does_not_mutate() {
        let mut scene = Scene::new();
        scene.create(SceneObject::new(id("earth"))).unwrap();
        assert_eq!(
            scene.apply_transaction(
                Revision(0),
                &[SceneCommand::Delete {
                    object: id("earth")
                },]
            ),
            Err(CoreError::RevisionConflict)
        );
        assert_eq!(scene.len(), 1);
    }
    #[test]
    fn snapshot_order_is_stable() {
        let mut scene = Scene::new();
        scene
            .apply_transaction(
                Revision(0),
                &[
                    SceneCommand::Create(SceneObject::new(id("z"))),
                    SceneCommand::Create(SceneObject::new(id("a"))),
                ],
            )
            .unwrap();
        let snapshot = scene.snapshot();
        assert_eq!(snapshot.objects[0].id().as_str(), "a");
    }
}
