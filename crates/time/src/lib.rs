//! Simulation time value types; scientific time scale selection is not frozen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockMode { Paused, Playing }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeGeneration(pub u64);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeInstant {
    pub scale: String,
    pub epoch: String,
    pub seconds: i64,
    pub nanos: u32,
}
impl TimeInstant {
    pub fn new(scale: impl Into<String>, epoch: impl Into<String>, seconds: i64, nanos: u32) -> Option<Self> {
        let scale = scale.into();
        let epoch = epoch.into();
        if scale.is_empty() || epoch.is_empty() || nanos >= 1_000_000_000 { return None; }
        Some(Self { scale, epoch, seconds, nanos })
    }
}
#[derive(Clone, Debug)]
pub struct SimulationClock {
    instant: TimeInstant,
    generation: TimeGeneration,
    mode: ClockMode,
}
impl SimulationClock {
    pub fn new(instant: TimeInstant) -> Self {
        Self { instant, generation: TimeGeneration(0), mode: ClockMode::Paused }
    }
    pub fn instant(&self) -> &TimeInstant { &self.instant }
    pub fn generation(&self) -> TimeGeneration { self.generation }
    pub fn mode(&self) -> ClockMode { self.mode }
    pub fn seek(&mut self, instant: TimeInstant) {
        self.instant = instant;
        self.generation.0 += 1;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn seek_invalidates_previous_generation() {
        let instant = TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap();
        let mut clock = SimulationClock::new(instant.clone());
        clock.seek(instant);
        assert_eq!(clock.generation(), TimeGeneration(1));
    }
}
