use crate::CoreError;

/// A sampled scientific state, not a predicted trajectory. Currently only ICRF
/// coordinates in kilometres and TDB seconds from J2000 are accepted.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectState {
    pub position_km: [f64; 3],
    pub radius_km: f64,
    pub epoch_tdb_seconds: f64,
    pub coverage_tdb_seconds: [f64; 2],
    pub frame: String,
    pub source: String,
}

impl ObjectState {
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        let [start, end] = self.coverage_tdb_seconds;
        if self.position_km.iter().any(|n| !n.is_finite())
            || !self.radius_km.is_finite()
            || self.radius_km <= 0.0
            || !self.epoch_tdb_seconds.is_finite()
            || !start.is_finite()
            || !end.is_finite()
            || start > self.epoch_tdb_seconds
            || end < self.epoch_tdb_seconds
            || self.frame != "ICRF"
            || self.source.trim().is_empty()
            || self.source.len() > 2048
        {
            return Err(CoreError::InvalidState);
        }
        Ok(())
    }
}
