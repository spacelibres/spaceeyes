use crate::CoreError;

/// A sampled scientific state, not a predicted trajectory. Currently only ICRF
/// coordinates in kilometres and TDB seconds from J2000 are accepted.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObjectState {
    /// Unit quaternion rotating body-local vectors into ICRF, scalar first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation_wxyz: Option<[f64; 4]>,
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
        if self.orientation_wxyz.is_some_and(|q| {
            q.iter().any(|n| !n.is_finite())
                || (q.iter().map(|n| n * n).sum::<f64>() - 1.0).abs() > 1e-6
        }) {
            return Err(CoreError::InvalidState);
        }
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

#[cfg(test)]
mod orientation_tests {
    use super::*;
    #[test]
    fn rejects_non_unit_orientation_and_preserves_absence() {
        let mut state = ObjectState {
            orientation_wxyz: None,
            position_km: [0.; 3],
            radius_km: 1.,
            epoch_tdb_seconds: 0.,
            coverage_tdb_seconds: [0., 1.],
            frame: "ICRF".into(),
            source: "test".into(),
        };
        assert!(state.validate().is_ok());
        state.orientation_wxyz = Some([0.; 4]);
        assert_eq!(state.validate(), Err(CoreError::InvalidState));
        state.orientation_wxyz = Some([1., 0., 0., 0.]);
        assert!(state.validate().is_ok());
        state.orientation_wxyz = Some([f64::NAN, 0., 0., 0.]);
        assert_eq!(state.validate(), Err(CoreError::InvalidState));
    }
}
