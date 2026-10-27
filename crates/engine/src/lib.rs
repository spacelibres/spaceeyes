//! Engine owns session lifecycle, scene command entry, and consistent read snapshots.
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{Scene, SceneCommand, SceneSnapshot};
use spaceeyes_spatial::{ReferenceFrameGraph, SpatialError, FrameSample, RigidTransform};
use spaceeyes_foundation::FrameId;
use spaceeyes_time::{SimulationClock, TimeGeneration, TimeInstant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineState { Ready, Running, Stopped }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineSnapshot {
    pub scene: SceneSnapshot,
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub sequence: u64,
    pub frame_graph_revision: Revision,
}

pub struct Engine {
    state: EngineState,
    scene: Scene,
    clock: SimulationClock,
    spatial: ReferenceFrameGraph,
    frame_sequence: u64,
}
impl Engine {
    pub fn new(instant: TimeInstant) -> Self {
        Self {
            state: EngineState::Ready,
            scene: Scene::new(),
            clock: SimulationClock::new(instant),
            spatial: ReferenceFrameGraph::new(),
            frame_sequence: 0,
        }
    }
    pub fn state(&self) -> EngineState { self.state }
    pub fn scene(&self) -> &Scene { &self.scene }
    pub fn clock(&self) -> &SimulationClock { &self.clock }
    pub fn spatial(&self) -> &ReferenceFrameGraph { &self.spatial }
    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            scene: self.scene.snapshot(),
            instant: self.clock.instant().clone(),
            generation: self.clock.generation(),
            sequence: self.frame_sequence,
            frame_graph_revision: self.spatial.revision(),
        }
    }
    pub fn start(&mut self) -> Result<(), CoreError> {
        if self.state != EngineState::Ready { return Err(CoreError::InvalidState); }
        self.state = EngineState::Running;
        Ok(())
    }
    /// The only Engine-facing scene write path. A future protocol adapter will call this.
    pub fn submit_scene(
        &mut self,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let previous = self.scene.revision();
        let next = self.scene.apply_transaction(expected_revision, commands)?;
        if next != previous { self.frame_sequence += 1; }
        Ok(next)
    }
    pub fn seek(&mut self, instant: TimeInstant) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        self.clock.seek(instant)?;
        self.frame_sequence += 1;
        Ok(())
    }
    pub fn play(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.play()?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    pub fn pause(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.pause()?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    pub fn step_nanos(&mut self, delta: i128) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.step_nanos(delta)?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    /// All spatial graph writes pass through Engine, never through plugins.
    pub fn register_root_frame(&mut self, id: FrameId) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next_sequence = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_root(id)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn register_child_frame(&mut self, id: FrameId, parent: FrameId, sample: FrameSample) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next_sequence = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_child(id, parent, sample)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn resolve_frame(&self, source: &FrameId, target: &FrameId, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        self.spatial.resolve(source, target, instant)
    }
    pub fn shutdown(&mut self) { self.state = EngineState::Stopped; }
}
#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_foundation::ObjectId;
    use spaceeyes_scene::SceneObject;
    use spaceeyes_spatial::{Vec3d, Quatd};

    fn instant() -> TimeInstant {
        TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap()
    }
    #[test]
    fn spatial_graph_revision_appears_in_engine_snapshot() {
        let mut engine = Engine::new(instant());
        let root = FrameId::new("root").unwrap();
        let child = FrameId::new("child").unwrap();
        engine.register_root_frame(root.clone()).unwrap();
        engine.register_child_frame(child.clone(), root.clone(), FrameSample {
            instant: instant(),
            to_parent: RigidTransform::new(Vec3d { x: 5.0, y: 0.0, z: 0.0 }, Quatd::IDENTITY).unwrap(),
        }).unwrap();
        assert_eq!(engine.snapshot().frame_graph_revision, Revision(2));
        assert_eq!(engine.snapshot().sequence, 2);
        assert_eq!(engine.resolve_frame(&child, &root, &instant()).unwrap().apply(Vec3d::ZERO).x, 5.0);
    }
    #[test]
    fn lifecycle_is_guarded() {
        let mut engine = Engine::new(instant());
        engine.start().unwrap();
        assert_eq!(engine.start(), Err(CoreError::InvalidState));
        engine.shutdown();
        assert_eq!(engine.state(), EngineState::Stopped);
        assert_eq!(engine.seek(instant()), Err(CoreError::AlreadyStopped));
    }
    #[test]
    fn time_commands_update_snapshot_once() {
        let mut engine = Engine::new(instant());
        engine.play().unwrap();
        engine.play().unwrap();
        assert_eq!(engine.snapshot().sequence, 1);
        engine.step_nanos(1_500_000_000).unwrap();
        assert_eq!(engine.snapshot().instant.seconds(), 1);
        assert_eq!(engine.snapshot().instant.nanos(), 500_000_000);
        assert_eq!(engine.snapshot().generation, TimeGeneration(0));
        engine.pause().unwrap();
        assert_eq!(engine.snapshot().sequence, 3);
    }
    #[test]
    fn command_and_snapshot_share_revision() {
        let mut engine = Engine::new(instant());
        let id = ObjectId::new("demo:earth").unwrap();
        engine.submit_scene(Revision(0), &[SceneCommand::Create(SceneObject::new(id))]).unwrap();
        let frame = engine.snapshot();
        assert_eq!(frame.scene.revision, Revision(1));
        assert_eq!(frame.sequence, 1);
        engine.seek(instant()).unwrap();
        assert_eq!(engine.snapshot().generation, TimeGeneration(1));
        assert_eq!(engine.snapshot().sequence, 2);
    }
}
