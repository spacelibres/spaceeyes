use crate::CoreError;

/// Seconds from J2000 in TDB. UTC/calendar conversion belongs to a time library,
/// never to frame-rate dependent arithmetic or a browser Date conversion.
#[derive(Debug, Clone)]
pub struct SimulationClock {
    epoch: f64,
    rate: f64,
    playing: bool,
}

impl Default for SimulationClock {
    fn default() -> Self {
        Self {
            epoch: 0.0,
            rate: 1.0,
            playing: false,
        }
    }
}

impl SimulationClock {
    pub fn epoch(&self) -> f64 {
        self.epoch
    }
    pub fn rate(&self) -> f64 {
        self.rate
    }
    pub fn is_playing(&self) -> bool {
        self.playing
    }
    pub fn set_playing(&mut self, playing: bool) {
        self.playing = playing;
    }
    pub fn seek(&mut self, epoch: f64) -> Result<(), CoreError> {
        if !epoch.is_finite() {
            return Err(CoreError::InvalidTime);
        }
        self.epoch = epoch;
        Ok(())
    }
    pub fn set_rate(&mut self, rate: f64) -> Result<(), CoreError> {
        if !rate.is_finite() {
            return Err(CoreError::InvalidTime);
        }
        self.rate = rate;
        Ok(())
    }
    pub fn advance(&mut self, elapsed_seconds: f64) -> Result<(), CoreError> {
        if !elapsed_seconds.is_finite() || elapsed_seconds < 0.0 {
            return Err(CoreError::InvalidTime);
        }
        if self.playing {
            self.seek(self.epoch + elapsed_seconds * self.rate)?;
        }
        Ok(())
    }
}
