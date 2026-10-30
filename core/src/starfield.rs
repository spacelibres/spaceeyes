use crate::{Core, CoreError, valid_id};
use std::sync::Arc;
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarfieldSpec {
    #[serde(default)]
    pub kind: StarfieldKind,
    pub frame: String,
    pub source: String,
    pub positions_km: Vec<f64>,
    pub colors_rgb: Vec<f32>,
    pub magnitudes: Vec<f32>,
    pub absolute_magnitudes: Vec<f32>,
}
#[derive(Debug, Default, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StarfieldKind {
    #[default]
    Star,
    Galaxy,
}
impl StarfieldSpec {
    pub fn validate(&self) -> Result<(), CoreError> {
        let n = self.magnitudes.len();
        if self.frame != "ICRF"
            || self.source.trim().is_empty()
            || self.source.len() > 1024
            || !(1..=50_000).contains(&n)
            || self.positions_km.len() != n * 3
            || self.colors_rgb.len() != n * 3
            || self.absolute_magnitudes.len() != n
            || !self
                .positions_km
                .iter()
                .all(|x| x.is_finite() && x.abs() <= 1e30)
            || !self
                .magnitudes
                .iter()
                .chain(&self.absolute_magnitudes)
                .all(|x| x.is_finite())
            || !self
                .colors_rgb
                .iter()
                .all(|x| x.is_finite() && (0.0..=1.0).contains(x))
            || self
                .positions_km
                .chunks_exact(3)
                .any(|p| p.iter().all(|x| *x == 0.0))
            || self
                .colors_rgb
                .chunks_exact(3)
                .any(|p| p.iter().all(|x| *x == 0.0))
        {
            return Err(CoreError::InvalidVisual);
        }
        Ok(())
    }
}
#[derive(Clone)]
pub(crate) struct StarfieldLayer {
    #[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
    pub revision: u64,
    pub spec: Arc<StarfieldSpec>,
}
impl Core {
    pub fn set_starfield(
        &mut self,
        plugin: &str,
        session: &str,
        layer: &str,
        spec: Option<StarfieldSpec>,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if !valid_id(layer) {
            return Err(CoreError::InvalidId);
        }
        let key = (session.to_owned(), layer.to_owned());
        let Some(spec) = spec else {
            self.starfields.remove(&key);
            return Ok(());
        };
        spec.validate()?;
        let others: Vec<_> = self
            .starfields
            .iter()
            .filter(|(k, _)| k.0 == session && **k != key)
            .collect();
        if others.len() >= 8
            || others
                .iter()
                .map(|(_, v)| v.spec.magnitudes.len())
                .sum::<usize>()
                + spec.magnitudes.len()
                > 50_000
        {
            return Err(CoreError::CapacityExceeded);
        }
        self.starfield_revision = self
            .starfield_revision
            .checked_add(1)
            .ok_or(CoreError::CapacityExceeded)?;
        self.starfields.insert(
            key,
            StarfieldLayer {
                revision: self.starfield_revision,
                spec: Arc::new(spec),
            },
        );
        Ok(())
    }
    pub fn starfield_count(&self) -> usize {
        self.starfields
            .values()
            .map(|v| v.spec.magnitudes.len())
            .sum()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn spec(n: usize) -> StarfieldSpec {
        StarfieldSpec {
            kind: StarfieldKind::Star,
            frame: "ICRF".into(),
            source: "test".into(),
            positions_km: vec![1.; n * 3],
            colors_rgb: vec![1.; n * 3],
            magnitudes: vec![1.; n],
            absolute_magnitudes: vec![1.; n],
        }
    }
    #[test]
    fn validation() {
        let mut s = spec(1);
        assert!(s.validate().is_ok());
        s.positions_km[0] = f64::NAN;
        assert!(s.validate().is_err());
        s = spec(1);
        s.colors_rgb.fill(0.);
        assert!(s.validate().is_err());
        s = spec(1);
        s.positions_km.fill(0.);
        assert!(s.validate().is_err());
    }
    #[test]
    fn permissions_budget_replace_cleanup() {
        let mut c = Core::default();
        c.open_session_with_permissions("denied", "p", crate::SessionPermissions::default())
            .unwrap();
        assert_eq!(
            c.set_starfield("p", "denied", "a", Some(spec(1))),
            Err(CoreError::PermissionDenied)
        );
        c.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                visual_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            c.set_starfield("wrong", "s", "a", Some(spec(1))),
            Err(CoreError::WrongOwner)
        );
        c.set_starfield("p", "s", "a", Some(spec(50_000))).unwrap();
        assert_eq!(
            c.set_starfield("p", "s", "b", Some(spec(1))),
            Err(CoreError::CapacityExceeded)
        );
        assert_eq!(c.starfield_count(), 50_000);
        c.set_starfield("p", "s", "a", Some(spec(1))).unwrap();
        assert_eq!(c.starfield_count(), 1);
        let mut bad = spec(2);
        bad.frame = "bad".into();
        assert!(c.set_starfield("p", "s", "a", Some(bad)).is_err());
        assert_eq!(c.starfield_count(), 1);
        c.release_session("s");
        assert_eq!(c.starfield_count(), 0);
        assert_eq!(
            c.set_starfield("p", "s", "a", None),
            Err(CoreError::InactiveSession)
        );
    }
}
