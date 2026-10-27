//! Scene owns authoritative object registry. This crate has no renderer dependency.
use std::collections::HashMap;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, Revision};

#[derive(Clone, Debug)]
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
#[derive(Default)]
pub struct Scene {
    objects: HashMap<ObjectId, SceneObject>,
    revision: u64,
}
impl Scene {
    pub fn new() -> Self { Self::default() }
    pub fn revision(&self) -> Revision { Revision(self.revision) }
    pub fn get(&self, id: &ObjectId) -> Option<&SceneObject> { self.objects.get(id) }
    pub fn create(&mut self, object: SceneObject) -> Result<(), CoreError> {
        if self.objects.contains_key(object.id()) { return Err(CoreError::DuplicateObject); }
        self.objects.insert(object.id.clone(), object);
        self.revision += 1;
        Ok(())
    }
    pub fn len(&self) -> usize { self.objects.len() }
    pub fn is_empty(&self) -> bool { self.objects.is_empty() }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_ids_are_rejected() {
        let id = ObjectId::new("demo:sun").unwrap();
        let mut scene = Scene::new();
        scene.create(SceneObject::new(id.clone())).unwrap();
        assert_eq!(scene.create(SceneObject::new(id)), Err(CoreError::DuplicateObject));
        assert_eq!(scene.revision(), Revision(1));
    }
}
