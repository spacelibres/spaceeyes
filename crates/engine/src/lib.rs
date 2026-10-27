//! Engine owns session lifecycle and coordinates scene/time authority.
use spaceeyes_foundation::CoreError;
use spaceeyes_scene::Scene;
use spaceeyes_time::{SimulationClock, TimeInstant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineState { Ready, Running, Stopped }

pub struct Engine {
    state: EngineState,
    scene: Scene,
    clock: SimulationClock,
}
impl Engine {
    pub fn new(instant: TimeInstant) -> Self {
        Self { state: EngineState::Ready, scene: Scene::new(), clock: SimulationClock::new(instant) }
    }
    pub fn state(&self) -> EngineState { self.state }
    pub fn scene(&self) -> &Scene { &self.scene }
    pub fn clock(&self) -> &SimulationClock { &self.clock }
    pub fn start(&mut self) -> Result<(), CoreError> {
        if self.state != EngineState::Ready { return Err(CoreError::InvalidState); }
        self.state = EngineState::Running;
        Ok(())
    }
    pub fn shutdown(&mut self) {
        self.state = EngineState::Stopped;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifecycle_is_guarded() {
        let instant = TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap();
        let mut engine = Engine::new(instant);
        engine.start().unwrap();
        assert_eq!(engine.start(), Err(CoreError::InvalidState));
        engine.shutdown();
        assert_eq!(engine.state(), EngineState::Stopped);
    }
}
