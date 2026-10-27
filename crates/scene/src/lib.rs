//! Authoritative scene registry and atomic command transactions.
//! ParentId is organizational; FrameId is an independent spatial reference.
use std::collections::HashMap;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, Revision};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneObject {
    id: ObjectId,
    parent: Option<ObjectId>,
    frame: Option<FrameId>,
    visible: bool,
}
impl SceneObject {
    pub fn new(id: ObjectId) -> Self {
        Self { id, parent: None, frame: None, visible: true }
    }
    pub fn id(&self) -> &ObjectId { &self.id }
    pub fn parent(&self) -> Option<&ObjectId> { self.parent.as_ref() }
    pub fn frame(&self) -> Option<&FrameId> { self.frame.as_ref() }
    pub fn visible(&self) -> bool { self.visible }
}

#[derive(Clone, Debug)]
pub enum SceneCommand {
    Create(SceneObject),
    SetParent { object: ObjectId, parent: Option<ObjectId> },
    SetFrame { object: ObjectId, frame: Option<FrameId> },
    SetVisibility { object: ObjectId, visible: bool },
    Delete { object: ObjectId },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SceneSnapshot {
    pub revision: Revision,
    pub objects: Vec<SceneObject>,
}

#[derive(Default, Clone)]
pub struct Scene {
    objects: HashMap<ObjectId, SceneObject>,
    revision: u64,
}
impl Scene {
    pub fn new() -> Self { Self::default() }
    pub fn revision(&self) -> Revision { Revision(self.revision) }
    pub fn get(&self, id: &ObjectId) -> Option<&SceneObject> { self.objects.get(id) }
    pub fn len(&self) -> usize { self.objects.len() }
    pub fn is_empty(&self) -> bool { self.objects.is_empty() }
    pub fn snapshot(&self) -> SceneSnapshot {
        let mut objects: Vec<_> = self.objects.values().cloned().collect();
        objects.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        SceneSnapshot { revision: self.revision(), objects }
    }
    /// Atomically apply all commands; no mutation if any command fails.
    pub fn apply_transaction(
        &mut self,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CoreError> {
        if self.revision() != expected_revision { return Err(CoreError::RevisionConflict); }
        if commands.is_empty() { return Ok(self.revision()); }
        let mut proposed = self.objects.clone();
        for command in commands {
            match command {
                SceneCommand::Create(obj) => {
                    if proposed.contains_key(obj.id()) { return Err(CoreError::DuplicateObject); }
                    proposed.insert(obj.id.clone(), obj.clone());
                }
                SceneCommand::SetParent { object, parent } => {
                    if let Some(p) = parent {
                        if !proposed.contains_key(p) { return Err(CoreError::ParentNotFound); }
                        let mut cursor = Some(p);
                        let mut remaining = proposed.len();
                        while let Some(id) = cursor {
                            if id == object { return Err(CoreError::HierarchyCycle); }
                            if remaining == 0 { return Err(CoreError::HierarchyCycle); }
                            remaining -= 1;
                            cursor = proposed.get(id).and_then(|entry| entry.parent.as_ref());
                        }
                    }
                    proposed.get_mut(object).ok_or(CoreError::UnknownObject)?.parent = parent.clone();
                }
                SceneCommand::SetFrame { object, frame } => {
                    proposed.get_mut(object).ok_or(CoreError::UnknownObject)?.frame = frame.clone();
                }
                SceneCommand::SetVisibility { object, visible } => {
                    proposed.get_mut(object).ok_or(CoreError::UnknownObject)?.visible = *visible;
                }
                SceneCommand::Delete { object } => {
                    if !proposed.contains_key(object) { return Err(CoreError::UnknownObject); }
                    if proposed.values().any(|entry| entry.parent.as_ref() == Some(object)) {
                        return Err(CoreError::HasChildren);
                    }
                    proposed.remove(object);
                }
            }
        }
        self.objects = proposed;
        self.revision += 1;
        Ok(self.revision())
    }
    /// Compatibility helper for initial bootstrap; later external writes use Engine.
    pub fn create(&mut self, object: SceneObject) -> Result<(), CoreError> {
        self.apply_transaction(self.revision(), &[SceneCommand::Create(object)]).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(value: &str) -> ObjectId { ObjectId::new(value).unwrap() }

    #[test]
    fn duplicate_ids_are_rejected() {
        let mut scene = Scene::new();
        scene.create(SceneObject::new(id("sun"))).unwrap();
        assert_eq!(scene.create(SceneObject::new(id("sun"))), Err(CoreError::DuplicateObject));
        assert_eq!(scene.revision(), Revision(1));
    }
    #[test]
    fn transaction_rolls_back_on_error() {
        let mut scene = Scene::new();
        let result = scene.apply_transaction(Revision(0), &[
            SceneCommand::Create(SceneObject::new(id("earth"))),
            SceneCommand::Delete { object: id("missing") },
        ]);
        assert_eq!(result, Err(CoreError::UnknownObject));
        assert!(scene.is_empty());
        assert_eq!(scene.revision(), Revision(0));
    }
    #[test]
    fn rejects_cycles_and_parent_deletion() {
        let mut scene = Scene::new();
        scene.apply_transaction(Revision(0), &[
            SceneCommand::Create(SceneObject::new(id("earth"))),
            SceneCommand::Create(SceneObject::new(id("moon"))),
            SceneCommand::SetParent { object: id("moon"), parent: Some(id("earth")) },
        ]).unwrap();
        assert_eq!(scene.apply_transaction(Revision(1), &[
            SceneCommand::SetParent { object: id("earth"), parent: Some(id("moon")) },
        ]), Err(CoreError::HierarchyCycle));
        assert_eq!(scene.apply_transaction(Revision(1), &[
            SceneCommand::Delete { object: id("earth") },
        ]), Err(CoreError::HasChildren));
        assert_eq!(scene.revision(), Revision(1));
    }
    #[test]
    fn revision_conflict_does_not_mutate() {
        let mut scene = Scene::new();
        scene.create(SceneObject::new(id("earth"))).unwrap();
        assert_eq!(scene.apply_transaction(Revision(0), &[
            SceneCommand::Delete { object: id("earth") },
        ]), Err(CoreError::RevisionConflict));
        assert_eq!(scene.len(), 1);
    }
    #[test]
    fn snapshot_order_is_stable() {
        let mut scene = Scene::new();
        scene.apply_transaction(Revision(0), &[
            SceneCommand::Create(SceneObject::new(id("z"))),
            SceneCommand::Create(SceneObject::new(id("a"))),
        ]).unwrap();
        let snapshot = scene.snapshot();
        assert_eq!(snapshot.objects[0].id().as_str(), "a");
    }
}
