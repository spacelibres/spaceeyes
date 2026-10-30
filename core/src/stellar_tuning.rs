use crate::{Core, CoreError, VisualSpec};
use std::collections::BTreeMap;
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StellarProfile {
    pub density: Vec<f64>,
    pub travel: Vec<f64>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StellarTuning {
    pub settings: BTreeMap<String, f64>,
    pub profile: StellarProfile,
}
pub const CONTROLS: &[(&str, f64, f64, f64, bool)] = &[
    ("surfaceEnabled", 0.0, 1.0, 1.0, true),
    ("volumeEnabled", 0.0, 1.0, 1.0, true),
    ("archesEnabled", 0.0, 1.0, 1.0, true),
    ("surfaceGain", 0.0, 4.0, 1.6, false),
    ("surfaceColor", 0.0, 16777215.0, 16777215.0, true),
    ("flowSpeed", 0.0, 2.0, 0.15, false),
    ("timeScale", 1.0, 86400.0, 3600.0, true),
    ("paused", 0.0, 1.0, 0.0, true),
    ("intensity", 0.0, 4.0, 1.0, false),
    ("windGain", 0.0, 4.0, 0.55, false),
    ("emissionPower", 0.1, 2.0, 0.3, false),
    ("extinction", 0.0, 4.0, 0.8, false),
    ("densityGain", 0.0, 8.0, 2.5, false),
    ("outerRadius", 1.25, 12.0, 12.0, false),
    ("fadeStart", 1.0, 12.0, 9.0, false),
    ("coolColor", 0.0, 16777215.0, 5833216.0, true),
    ("hotColor", 0.0, 16777215.0, 16755727.0, true),
    ("channelFrequency", 1.0, 40.0, 11.0, false),
    ("channelLow", 0.0, 1.0, 0.4, false),
    ("channelHigh", 0.0, 1.0, 0.78, false),
    ("parcelFrequency", 0.5, 16.0, 4.0, false),
    ("parcelLow", 0.0, 1.0, 0.53, false),
    ("parcelHigh", 0.0, 1.0, 0.77, false),
    ("phaseFade", 0.005, 0.2, 0.035, false),
    ("flameGain", 0.0, 2.0, 0.75, false),
    ("flameMin", 0.0, 0.3, 0.1, false),
    ("flameHeight", 0.0, 1.0, 0.7, false),
    ("baseDensity", 0.0, 0.2, 0.045, false),
    ("baseDecay", 1.0, 30.0, 9.0, false),
    ("warpFrequency", 1.0, 20.0, 7.0, false),
    ("streamFrequency", 4.0, 64.0, 32.0, true),
    ("streamLow", 0.0, 1.0, 0.42, false),
    ("streamHigh", 0.0, 1.0, 0.78, false),
    ("warpGain", 0.0, 6.0, 3.0, false),
    ("streamSpeed", 0.0, 8.0, 2.0, false),
    ("heightFrequency", 1.0, 80.0, 35.0, true),
    ("archGain", 0.0, 4.0, 1.0, false),
    ("archCount", 0.0, 32.0, 24.0, true),
    ("strandCount", 1.0, 5.0, 5.0, true),
    ("archHeight", 0.2, 2.0, 1.0, false),
    ("archSpread", 0.2, 2.0, 1.0, false),
    ("archWidth", 0.2, 3.0, 1.0, false),
    ("archLow", 0.0, 1.0, 0.25, false),
    ("archHigh", 0.0, 1.0, 0.8, false),
    ("archSpeed", 0.0, 4.0, 1.0, false),
    ("archLifeSpeed", 0.0, 4.0, 1.0, false),
    ("archLifeMin", 0.0, 1.0, 0.25, false),
    ("archEdge", 0.1, 3.0, 0.65, false),
    ("archCoolColor", 0.0, 16777215.0, 9241088.0, true),
    ("archHotColor", 0.0, 16777215.0, 16757516.0, true),
    ("temperatureMK", 0.5, 3.0, 1.5, false),
    ("densityCm3", 0.1, 100.0, 5.0, false),
    ("sampleCount", 4.0, 24.0, 12.0, true),
    ("earlyExit", 0.005, 0.1, 0.02, false),
    ("jitter", 0.0, 0.5, 0.1, false),
    ("enterDistance", 2.0, 20.0, 8.0, false),
    ("exitDistance", 2.0, 20.0, 10.0, false),
    ("fullDistance", 1.0, 20.0, 6.0, false),
];
impl StellarTuning {
    pub fn value(&self, key: &str) -> f64 {
        self.settings[key]
    }
    pub fn valid(&self) -> bool {
        if self.settings.len() != CONTROLS.len()
            || !CONTROLS.iter().all(|(k, lo, hi, _, integer)| {
                self.settings.get(*k).is_some_and(|v| {
                    v.is_finite() && v >= lo && v <= hi && (!integer || v.fract() == 0.)
                })
            })
        {
            return false;
        }
        let s = |k| self.value(k);
        if ![
            ("channelLow", "channelHigh"),
            ("parcelLow", "parcelHigh"),
            ("streamLow", "streamHigh"),
            ("archLow", "archHigh"),
            ("enterDistance", "exitDistance"),
            ("fadeStart", "outerRadius"),
        ]
        .iter()
        .all(|(a, b)| s(a) < s(b))
            || s("fullDistance") > s("enterDistance")
            || s("archCount") * s("strandCount") * 49. * 7. > 50000.
        {
            return false;
        }
        let p = &self.profile;
        p.density.len() == 64
            && p.travel.len() == 64
            && (p.density[0] - 1.).abs() < 0.00001
            && p.travel[0] == 0.
            && p.density
                .iter()
                .all(|v| v.is_finite() && *v > 0. && *v <= 1.00001)
            && p.travel
                .iter()
                .all(|v| v.is_finite() && *v >= 0. && *v <= 1e12)
            && p.travel.windows(2).all(|w| w[0] < w[1])
    }
}
impl Core {
    pub fn tune_stellar(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        tuning: StellarTuning,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self.objects.get(target).ok_or(CoreError::UnknownObject)? != session {
            return Err(CoreError::WrongOwner);
        }
        if !tuning.valid() {
            return Err(CoreError::InvalidVisual);
        }
        if !matches!(
            self.visuals.get(target).map(|v| &v.spec),
            Some(VisualSpec::Sphere {
                stellar: Some(_),
                ..
            })
        ) {
            return Err(CoreError::InvalidVisual);
        }
        self.stellar_tuning.insert(target.into(), tuning);
        Ok(())
    }
    pub fn stellar_tuning(&self, target: &str) -> Option<&StellarTuning> {
        self.stellar_tuning.get(target)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> StellarTuning {
        StellarTuning {
            settings: CONTROLS
                .iter()
                .map(|(k, _, _, v, _)| (k.to_string(), *v))
                .collect(),
            profile: StellarProfile {
                density: vec![1.; 64],
                travel: (0..64).map(|i| i as f64).collect(),
            },
        }
    }
    #[test]
    fn snapshot_bounds_and_cross_constraints() {
        let mut t = valid();
        assert!(t.valid());
        t.settings.insert("archCount".into(), 32.);
        assert!(!t.valid());
        t = valid();
        t.settings.insert("channelLow".into(), 0.9);
        assert!(!t.valid());
        t = valid();
        t.settings.insert("sampleCount".into(), 12.5);
        assert!(!t.valid());
        t = valid();
        t.settings.insert("unexpected".into(), 1.);
        assert!(!t.valid());
        t = valid();
        t.profile.travel[5] = 0.;
        assert!(!t.valid());
        t = valid();
        t.profile.density[5] = f64::NAN;
        assert!(!t.valid());
    }
    #[test]
    fn owned_tuning_preserves_revision_and_cleans_lifecycle() {
        let mut c = Core::default();
        c.open_session_with_permissions(
            "a",
            "a",
            crate::SessionPermissions {
                visual_control: true,
                data_publish: true,
                ..Default::default()
            },
        )
        .unwrap();
        c.register_object("a", "sun").unwrap();
        let spec: VisualSpec = serde_json::from_value(
            serde_json::json!({"kind":"sphere","stellar":{"coronaIntensity":1.,"flowSpeed":0.15}}),
        )
        .unwrap();
        c.set_visual("a", "a", "sun", Some(spec.clone())).unwrap();
        let revision = c.visual_assignment("sun").unwrap().revision;
        c.tune_stellar("a", "a", "sun", valid()).unwrap();
        assert_eq!(c.stellar_tuning("sun").unwrap().profile.travel[63], 63.);
        assert_eq!(c.visual_assignment("sun").unwrap().revision, revision);
        c.set_visual("a", "a", "sun", None).unwrap();
        assert!(c.stellar_tuning("sun").is_none());
        c.set_visual("a", "a", "sun", Some(spec)).unwrap();
        c.tune_stellar("a", "a", "sun", valid()).unwrap();
        c.release_session("a");
        assert!(c.stellar_tuning.is_empty());
    }
    #[test]
    fn wire_rejects_unknown_fields() {
        let mut value = serde_json::to_value(valid()).unwrap();
        value["diagnostics"] = serde_json::json!({});
        assert!(serde_json::from_value::<StellarTuning>(value).is_err());
    }
}
