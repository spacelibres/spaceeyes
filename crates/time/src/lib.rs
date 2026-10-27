//! Authoritative simulation clock. No implicit system clock or assumed scientific epoch.
use spaceeyes_foundation::CoreError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockMode { Paused, Playing }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeGeneration(pub u64);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeInstant {
    scale: String,
    epoch: String,
    seconds: i64,
    nanos: u32,
}
impl TimeInstant {
    pub fn new(scale: impl Into<String>, epoch: impl Into<String>, seconds: i64, nanos: u32) -> Option<Self> {
        let scale = scale.into();
        let epoch = epoch.into();
        if scale.trim().is_empty() || epoch.trim().is_empty() || nanos >= 1_000_000_000 { return None; }
        Some(Self { scale, epoch, seconds, nanos })
    }
    pub fn scale(&self) -> &str { &self.scale }
    pub fn epoch(&self) -> &str { &self.epoch }
    pub fn seconds(&self) -> i64 { self.seconds }
    pub fn nanos(&self) -> u32 { self.nanos }
    /// Signed duration in nanoseconds; no time-scale conversion is implied.
    pub fn checked_add_nanos(&self, delta: i128) -> Option<Self> {
        let total = i128::from(self.seconds)
            .checked_mul(1_000_000_000)?
            .checked_add(i128::from(self.nanos))?
            .checked_add(delta)?;
        let seconds = i64::try_from(total.div_euclid(1_000_000_000)).ok()?;
        let nanos = u32::try_from(total.rem_euclid(1_000_000_000)).ok()?;
        Some(Self { scale: self.scale.clone(), epoch: self.epoch.clone(), seconds, nanos })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClockSnapshot {
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub revision: u64,
    pub mode: ClockMode,
}
#[derive(Clone, Debug)]
pub struct SimulationClock {
    instant: TimeInstant,
    generation: TimeGeneration,
    revision: u64,
    mode: ClockMode,
}
impl SimulationClock {
    pub fn new(instant: TimeInstant) -> Self {
        Self { instant, generation: TimeGeneration(0), revision: 0, mode: ClockMode::Paused }
    }
    pub fn instant(&self) -> &TimeInstant { &self.instant }
    pub fn generation(&self) -> TimeGeneration { self.generation }
    pub fn mode(&self) -> ClockMode { self.mode }
    pub fn snapshot(&self) -> ClockSnapshot {
        ClockSnapshot { instant: self.instant.clone(), generation: self.generation, revision: self.revision, mode: self.mode }
    }
    pub fn play(&mut self) -> Result<(), CoreError> { self.set_mode(ClockMode::Playing) }
    pub fn pause(&mut self) -> Result<(), CoreError> { self.set_mode(ClockMode::Paused) }
    fn set_mode(&mut self, mode: ClockMode) -> Result<(), CoreError> {
        if self.mode != mode {
            self.revision = self.revision.checked_add(1).ok_or(CoreError::InvalidState)?;
            self.mode = mode;
        }
        Ok(())
    }
    pub fn seek(&mut self, instant: TimeInstant) -> Result<(), CoreError> {
        let generation = self.generation.0.checked_add(1).ok_or(CoreError::InvalidState)?;
        let revision = self.revision.checked_add(1).ok_or(CoreError::InvalidState)?;
        self.instant = instant;
        self.generation = TimeGeneration(generation);
        self.revision = revision;
        Ok(())
    }
    /// Explicit step, independent of wall-clock and rendering frames.
    /// A step does not invalidate the time generation.
    pub fn step_nanos(&mut self, delta: i128) -> Result<(), CoreError> {
        if delta == 0 { return Ok(()); }
        let instant = self.instant.checked_add_nanos(delta).ok_or(CoreError::InvalidState)?;
        let revision = self.revision.checked_add(1).ok_or(CoreError::InvalidState)?;
        self.instant = instant;
        self.revision = revision;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn instant() -> TimeInstant { TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap() }
    #[test]
    fn seek_invalidates_previous_generation() {
        let mut clock = SimulationClock::new(instant());
        clock.seek(instant()).unwrap();
        assert_eq!(clock.generation(), TimeGeneration(1));
    }
    #[test]
    fn step_handles_negative_nanoseconds() {
        let mut clock = SimulationClock::new(instant());
        clock.step_nanos(-1).unwrap();
        assert_eq!(clock.instant().seconds(), -1);
        assert_eq!(clock.instant().nanos(), 999_999_999);
        assert_eq!(clock.generation(), TimeGeneration(0));
    }
    #[test]
    fn invalid_step_preserves_state() {
        let start = TimeInstant::new("TT", "epoch", i64::MAX, 999_999_999).unwrap();
        let mut clock = SimulationClock::new(start);
        let before = clock.snapshot();
        assert_eq!(clock.step_nanos(1), Err(CoreError::InvalidState));
        assert_eq!(clock.snapshot(), before);
    }
    #[test]
    fn pause_and_play_do_not_invalidate_generation() {
        let mut clock = SimulationClock::new(instant());
        clock.play().unwrap();
        clock.pause().unwrap();
        assert_eq!(clock.generation(), TimeGeneration(0));
        assert_eq!(clock.snapshot().revision, 2);
    }
}
