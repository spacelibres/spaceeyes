//! Engine owns session lifecycle, scene command entry, and consistent read snapshots.
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{Scene, SceneCommand, SceneSnapshot};
use spaceeyes_time::{SimulationClock, TimeGeneration, TimeInstant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineState { Ready, Running, Stopped }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineSnapshot {
    pub scene: SceneSnapshot,
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub sequence: u64,
}

pub struct Engine {
    state: EngineState,
    scene: Scene,
    clock: SimulationClock,
    frame_sequence: u64,
}
impl Engine {
    pub fn new(instant: TimeInstant) -> Self {
        Self {
            state: EngineState::Ready,
            scene: Scene::new(),
            clock: SimulationClock::new(instant),
            frame_sequence: 0,
        }
    }
    pub fn state(&self) -> EngineState { self.state }
    pub fn scene(&self) -> &Scene { &self.scene }
    pub fn clock(&self) -> &SimulationClock { &self.clock }
    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            scene: self.scene.snapshot(),
            instant: self.clock.instant().clone(),
            generation: self.clock.generation(),
            sequence: self.frame_sequence,
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
        self.clock.seek(instant);
        self.frame_sequence += 1;
        Ok(())
    }
    pub fn shutdown(&mut self) { self.state = EngineState::Stopped; }
}
#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_foundation::ObjectId;
    use spaceeyes_scene::SceneObject;

    fn instant() -> TimeInstant {
        TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap()
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
