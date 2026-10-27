// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Authoritative simulation clock. No implicit system clock or assumed scientific epoch.
use spaceeyes_foundation::CoreError;

/// Exact simulation nanoseconds / host nanoseconds. Construction validates policy bounds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlaybackRate {
    numerator: i32,
    denominator: u32,
}
impl PlaybackRate {
    pub const UNIT: Self = Self {
        numerator: 1,
        denominator: 1,
    };
    pub fn new(numerator: i32, denominator: u32) -> Result<Self, CoreError> {
        if denominator == 0 || denominator > 1_000_000 {
            return Err(CoreError::InvalidState);
        }
        let mut a = numerator.unsigned_abs();
        let mut b = denominator;
        while b != 0 {
            let r = a % b;
            a = b;
            b = r;
        }
        let gcd = a.max(1);
        let numerator = numerator / gcd as i32;
        if numerator.unsigned_abs() > 1_000_000 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            numerator,
            denominator: denominator / gcd,
        })
    }
    pub fn numerator(self) -> i32 {
        self.numerator
    }
    pub fn denominator(self) -> u32 {
        self.denominator
    }
}
#[derive(Clone, Debug)]
pub struct FixedStepper {
    step_nanos: u64,
    max_steps: u32,
    backlog_nanos: u128,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StepBatch {
    pub steps: u32,
    pub step_nanos: u64,
    pub backlog_nanos: u128,
}
impl FixedStepper {
    pub fn new(step_nanos: u64, max_steps: u32) -> Result<Self, CoreError> {
        if step_nanos == 0 || max_steps == 0 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            step_nanos,
            max_steps,
            backlog_nanos: 0,
        })
    }
    pub fn accumulate(&mut self, elapsed_nanos: u64) -> Result<StepBatch, CoreError> {
        let total = self
            .backlog_nanos
            .checked_add(u128::from(elapsed_nanos))
            .ok_or(CoreError::InvalidState)?;
        let steps = (total / u128::from(self.step_nanos)).min(u128::from(self.max_steps)) as u32;
        self.backlog_nanos = total - u128::from(steps) * u128::from(self.step_nanos);
        Ok(StepBatch {
            steps,
            step_nanos: self.step_nanos,
            backlog_nanos: self.backlog_nanos,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClockMode {
    Paused,
    Playing,
}

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
    pub fn new(
        scale: impl Into<String>,
        epoch: impl Into<String>,
        seconds: i64,
        nanos: u32,
    ) -> Option<Self> {
        let scale = scale.into();
        let epoch = epoch.into();
        if scale.trim().is_empty() || epoch.trim().is_empty() || nanos >= 1_000_000_000 {
            return None;
        }
        Some(Self {
            scale,
            epoch,
            seconds,
            nanos,
        })
    }
    pub fn scale(&self) -> &str {
        &self.scale
    }
    pub fn epoch(&self) -> &str {
        &self.epoch
    }
    pub fn seconds(&self) -> i64 {
        self.seconds
    }
    pub fn nanos(&self) -> u32 {
        self.nanos
    }
    /// Signed duration in nanoseconds; no time-scale conversion is implied.
    pub fn checked_add_nanos(&self, delta: i128) -> Option<Self> {
        let total = i128::from(self.seconds)
            .checked_mul(1_000_000_000)?
            .checked_add(i128::from(self.nanos))?
            .checked_add(delta)?;
        let seconds = i64::try_from(total.div_euclid(1_000_000_000)).ok()?;
        let nanos = u32::try_from(total.rem_euclid(1_000_000_000)).ok()?;
        Some(Self {
            scale: self.scale.clone(),
            epoch: self.epoch.clone(),
            seconds,
            nanos,
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClockSnapshot {
    pub rate: PlaybackRate,
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub revision: u64,
    pub mode: ClockMode,
}
#[derive(Clone, Debug)]
pub struct SimulationClock {
    rate: PlaybackRate,
    remainder: i128,
    instant: TimeInstant,
    generation: TimeGeneration,
    revision: u64,
    mode: ClockMode,
}
impl SimulationClock {
    pub fn new(instant: TimeInstant) -> Self {
        Self {
            rate: PlaybackRate::UNIT,
            remainder: 0,
            instant,
            generation: TimeGeneration(0),
            revision: 0,
            mode: ClockMode::Paused,
        }
    }
    /// Restore a new session, paused, invalidating the previous task generation.
    pub fn restore(snapshot: &ClockSnapshot) -> Result<Self, CoreError> {
        let generation = snapshot
            .generation
            .0
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        Ok(Self {
            instant: snapshot.instant.clone(),
            generation: TimeGeneration(generation),
            revision: 0,
            mode: ClockMode::Paused,
            rate: snapshot.rate,
            remainder: 0,
        })
    }
    pub fn instant(&self) -> &TimeInstant {
        &self.instant
    }
    pub fn generation(&self) -> TimeGeneration {
        self.generation
    }
    pub fn mode(&self) -> ClockMode {
        self.mode
    }
    pub fn snapshot(&self) -> ClockSnapshot {
        ClockSnapshot {
            rate: self.rate,
            instant: self.instant.clone(),
            generation: self.generation,
            revision: self.revision,
            mode: self.mode,
        }
    }
    pub fn play(&mut self) -> Result<(), CoreError> {
        self.set_mode(ClockMode::Playing)
    }
    pub fn pause(&mut self) -> Result<(), CoreError> {
        self.set_mode(ClockMode::Paused)
    }
    fn set_mode(&mut self, mode: ClockMode) -> Result<(), CoreError> {
        if self.mode != mode {
            self.revision = self
                .revision
                .checked_add(1)
                .ok_or(CoreError::InvalidState)?;
            self.mode = mode;
        }
        Ok(())
    }
    pub fn seek(&mut self, instant: TimeInstant) -> Result<(), CoreError> {
        let generation = self
            .generation
            .0
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.instant = instant;
        self.remainder = 0;
        self.generation = TimeGeneration(generation);
        self.revision = revision;
        Ok(())
    }
    pub fn set_rate(&mut self, rate: PlaybackRate) -> Result<(), CoreError> {
        if self.rate == rate {
            return Ok(());
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.rate = rate;
        self.remainder = 0;
        self.revision = revision;
        Ok(())
    }
    /// Exact host-driven elapsed-time accumulation at an explicit rational rate.
    pub fn advance_nanos(&mut self, elapsed_nanos: u64) -> Result<(), CoreError> {
        if self.mode == ClockMode::Paused || elapsed_nanos == 0 || self.rate.numerator == 0 {
            return Ok(());
        }
        let total = i128::from(elapsed_nanos)
            .checked_mul(i128::from(self.rate.numerator))
            .and_then(|v| v.checked_add(self.remainder))
            .ok_or(CoreError::InvalidState)?;
        let denominator = i128::from(self.rate.denominator);
        let delta = total / denominator;
        let remainder = total % denominator;
        let instant = self
            .instant
            .checked_add_nanos(delta)
            .ok_or(CoreError::InvalidState)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.instant = instant;
        self.remainder = remainder;
        self.revision = revision;
        Ok(())
    }
    /// Explicit step, independent of wall-clock and rendering frames.
    /// A step does not invalidate the time generation.
    pub fn step_nanos(&mut self, delta: i128) -> Result<(), CoreError> {
        if delta == 0 {
            return Ok(());
        }
        let instant = self
            .instant
            .checked_add_nanos(delta)
            .ok_or(CoreError::InvalidState)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.instant = instant;
        self.remainder = 0;
        self.revision = revision;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn instant() -> TimeInstant {
        TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap()
    }
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
    #[test]
    fn playback_ignores_paused_elapsed_and_resumes_without_catching_up() {
        let mut clock = SimulationClock::new(instant());
        let paused = clock.snapshot();
        clock.advance_nanos(u64::MAX).unwrap();
        assert_eq!(clock.snapshot(), paused);
        clock.play().unwrap();
        clock.advance_nanos(1_500_000_000).unwrap();
        clock.pause().unwrap();
        let paused = clock.snapshot();
        clock.advance_nanos(9_000_000_000).unwrap();
        assert_eq!(clock.snapshot(), paused);
        clock.play().unwrap();
        clock.advance_nanos(500_000_000).unwrap();
        assert_eq!(
            clock.instant(),
            &TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 2, 0).unwrap()
        );
        assert_eq!(clock.generation(), TimeGeneration(0));
    }
    #[test]
    fn playback_zero_is_noop_and_partitioning_preserves_instant() {
        let mut clock = SimulationClock::new(instant());
        clock.play().unwrap();
        let before = clock.snapshot();
        clock.advance_nanos(0).unwrap();
        assert_eq!(clock.snapshot(), before);
        let mut single = clock.clone();
        single.advance_nanos(u64::MAX).unwrap();
        clock.advance_nanos(u64::MAX / 2).unwrap();
        clock.advance_nanos(u64::MAX - u64::MAX / 2).unwrap();
        assert_eq!(clock.instant(), single.instant());
        assert_eq!(clock.generation(), single.generation());
    }
    #[test]
    fn playback_overflow_preserves_entire_clock() {
        let mut clock =
            SimulationClock::new(TimeInstant::new("TT", "epoch", i64::MAX, 999_999_999).unwrap());
        clock.play().unwrap();
        let before = clock.snapshot();
        assert_eq!(clock.advance_nanos(1), Err(CoreError::InvalidState));
        assert_eq!(clock.snapshot(), before);
        clock.revision = u64::MAX;
        clock.instant = instant();
        let before = clock.snapshot();
        assert_eq!(clock.advance_nanos(1), Err(CoreError::InvalidState));
        assert_eq!(clock.snapshot(), before);
    }
}
