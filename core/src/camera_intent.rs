#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraRenderStatus {
    pub focused_id: Option<String>,
    pub position_km: [f64; 3],
    pub desired_km: [f64; 3],
    pub framing_radius_km: f64,
    pub collision_adjusted: bool,
    pub desired_inside: Vec<String>,
}
use crate::{Core, CoreError};
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CameraObservation {
    pub target_id: String,
    pub mode: String,
    #[serde(default)]
    pub members: Vec<String>,
    pub follow_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_id: Option<String>,
}
impl Core {
    pub fn camera_render_status(&self) -> Option<CameraRenderStatus> {
        self.camera_render_status.clone()
    }
    #[cfg(any(feature = "browser-render", test))]
    pub(crate) fn record_camera_render_status(&mut self, status: Option<CameraRenderStatus>) {
        self.camera_render_status = status.filter(|s| {
            s.position_km
                .iter()
                .chain(s.desired_km.iter())
                .all(|n| n.is_finite())
                && s.framing_radius_km.is_finite()
                && s.framing_radius_km >= 0.
        });
    }

    pub fn camera_lighting(&self) -> &str {
        self.camera_lighting
            .as_ref()
            .map_or("natural", |(_, mode)| mode.as_str())
    }
    pub fn set_camera_lighting(
        &mut self,
        session: &str,
        plugin: &str,
        mode: &str,
    ) -> Result<(), CoreError> {
        self.input_authorize(session, plugin)?;
        if !["natural", "shadow", "flood"].contains(&mode) {
            return Err(CoreError::InvalidState);
        }
        self.camera_lighting = Some((session.into(), mode.into()));
        Ok(())
    }

    pub fn camera_observation(&self) -> Option<&CameraObservation> {
        self.observation.as_ref().map(|(_, v)| v)
    }
    pub fn set_camera_observation_with_context(
        &mut self,
        s: &str,
        p: &str,
        observation: CameraObservation,
    ) -> Result<(), CoreError> {
        self.input_authorize(s, p)?;
        if let Some(id) = observation.system_id.as_deref() {
            self.object_state_at(id, self.clock().epoch())?;
        }
        self.set_camera_observation(
            s,
            p,
            &observation.target_id,
            &observation.mode,
            observation.members,
            observation.follow_id,
        )?;
        if let Some((_, current)) = self.observation.as_mut() {
            current.system_id = observation.system_id;
        }
        Ok(())
    }
    pub fn set_camera_observation(
        &mut self,
        s: &str,
        p: &str,
        target: &str,
        mode: &str,
        members: Vec<String>,
        follow: Option<String>,
    ) -> Result<(), CoreError> {
        self.input_authorize(s, p)?;
        if std::iter::once(target)
            .chain(members.iter().map(String::as_str))
            .chain(follow.as_deref())
            .any(|id| self.object_state_at(id, self.clock().epoch()).is_err())
        {
            return Err(CoreError::InvalidState);
        }
        if !["nearby", "system", "follow"].contains(&mode)
            || members.len() > 128
            || members
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != members.len()
            || members
                .iter()
                .chain(follow.iter())
                .any(|id| !self.objects.contains_key(id))
            || (mode == "system" && (!members.iter().any(|id| id == target) || follow.is_some()))
            || (mode == "nearby" && (!members.is_empty() || follow.is_some()))
            || (mode == "follow"
                && (!members.is_empty() || follow.as_deref().is_none_or(|id| id == target)))
        {
            return Err(CoreError::InvalidState);
        }
        if mode == "follow" {
            let target_state = self.object_state_at(target, self.clock().epoch())?;
            let reference = self.object_state_at(
                follow.as_deref().ok_or(CoreError::InvalidState)?,
                self.clock().epoch(),
            )?;
            if target_state.position_km == reference.position_km {
                return Err(CoreError::InvalidState);
            }
        }
        self.focus(s, p, target)?;
        self.observation = Some((
            s.into(),
            CameraObservation {
                target_id: target.into(),
                mode: mode.into(),
                members,
                follow_id: follow,
                system_id: None,
            },
        ));
        Ok(())
    }
    fn input_authorize(&self, s: &str, p: &str) -> Result<(), CoreError> {
        let session = self.sessions.get(s).ok_or(CoreError::InactiveSession)?;
        if session.plugin_id != p {
            return Err(CoreError::WrongOwner);
        }
        if !session.permissions.camera_control {
            return Err(CoreError::PermissionDenied);
        }
        Ok(())
    }
    pub fn camera_orbit(&mut self, s: &str, p: &str, y: f32, x: f32) -> Result<(), CoreError> {
        self.input_authorize(s, p)?;
        if !y.is_finite() || !x.is_finite() || y.abs() > 0.5 || x.abs() > 0.5 {
            return Err(CoreError::InvalidState);
        }
        self.camera_input_owner = Some(s.into());
        self.camera_input[0] = (self.camera_input[0] + y).clamp(-0.5, 0.5);
        self.camera_input[1] = (self.camera_input[1] + x).clamp(-0.5, 0.5);
        Ok(())
    }
    pub fn camera_zoom(&mut self, s: &str, p: &str, d: f32) -> Result<(), CoreError> {
        self.input_authorize(s, p)?;
        if !d.is_finite() || d.abs() > 1.0 {
            return Err(CoreError::InvalidState);
        }
        self.camera_input_owner = Some(s.into());
        self.camera_input[2] = (self.camera_input[2] + d).clamp(-1., 1.);
        Ok(())
    }
    pub fn take_camera_input(&mut self) -> [f32; 3] {
        std::mem::take(&mut self.camera_input)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn core() -> Core {
        let mut c = Core::default();
        c.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                camera_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        for id in ["a", "b"] {
            c.register_object("s", id).unwrap();
            c.set_object_state(
                "s",
                id,
                crate::ObjectState {
                    position_km: [if id == "a" { 0. } else { 50. }, 0., 0.],
                    radius_km: 1.,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    frame: "ICRF".into(),
                    source: "test".into(),
                    orientation_wxyz: None,
                },
            )
            .unwrap();
        }
        c
    }
    #[test]
    fn observation_system_is_validated_atomically_and_survives_missing_geometry() {
        let mut c = core();
        let request = |system: &str| CameraObservation {
            target_id: "a".into(),
            mode: "nearby".into(),
            members: vec![],
            follow_id: None,
            system_id: Some(system.into()),
        };
        c.set_camera_observation_with_context("s", "p", request("b"))
            .unwrap();
        assert_eq!(
            c.camera_observation().unwrap().system_id.as_deref(),
            Some("b")
        );
        assert!(c.trajectory_style("a").is_none());
        assert!(
            c.set_camera_observation_with_context("s", "p", request("missing"))
                .is_err()
        );
        assert_eq!(
            c.camera_observation().unwrap().system_id.as_deref(),
            Some("b")
        );
        assert!(
            c.set_camera_observation_with_context("s", "wrong", request("b"))
                .is_err()
        );
        c.focus("s", "p", "a").unwrap();
        assert!(c.camera_observation().is_none());
    }
    #[test]
    fn render_status_is_finite_read_only_and_clearable() {
        let mut c = core();
        assert!(c.camera_render_status().is_none());
        let status = CameraRenderStatus {
            focused_id: Some("a".into()),
            position_km: [1., 2., 3.],
            desired_km: [4., 5., 6.],
            framing_radius_km: 1.,
            collision_adjusted: true,
            desired_inside: vec!["b".into()],
        };
        c.record_camera_render_status(Some(status.clone()));
        assert_eq!(c.camera_render_status().unwrap().position_km, [1., 2., 3.]);
        let json = serde_json::to_value(c.camera_render_status()).unwrap();
        assert_eq!(json["focusedId"], "a");
        let mut invalid = status;
        invalid.position_km[0] = f64::NAN;
        c.record_camera_render_status(Some(invalid));
        assert!(c.camera_render_status().is_none());
        c.record_camera_render_status(None);
        assert!(c.camera_render_status().is_none());
    }
    #[test]
    fn lighting_requires_permission_validates_and_releases_owner() {
        let mut c = core();
        assert_eq!(c.camera_lighting(), "natural");
        assert_eq!(
            c.set_camera_lighting("missing", "p", "flood"),
            Err(CoreError::InactiveSession)
        );
        assert_eq!(
            c.set_camera_lighting("s", "other", "flood"),
            Err(CoreError::WrongOwner)
        );
        c.open_session_with_permissions("reader", "reader", crate::SessionPermissions::default())
            .unwrap();
        assert_eq!(
            c.set_camera_lighting("reader", "reader", "flood"),
            Err(CoreError::PermissionDenied)
        );
        for mode in ["shadow", "flood", "natural"] {
            c.set_camera_lighting("s", "p", mode).unwrap();
            assert_eq!(c.camera_lighting(), mode);
        }
        c.set_camera_lighting("s", "p", "shadow").unwrap();
        assert!(c.set_camera_lighting("s", "p", "SHADOW").is_err());
        assert_eq!(c.camera_lighting(), "shadow");
        c.release_session("reader");
        assert_eq!(c.camera_lighting(), "shadow");
        c.release_session("s");
        assert_eq!(c.camera_lighting(), "natural");
    }
    #[test]
    fn input_authorization_bounds_consumption_and_release() {
        let mut c = core();
        assert!(c.camera_orbit("s", "wrong", 0., 0.).is_err());
        for value in [f32::NAN, f32::INFINITY, 0.51] {
            assert!(c.camera_orbit("s", "p", value, 0.).is_err());
        }
        assert!(c.camera_zoom("s", "p", 1.01).is_err());
        c.camera_orbit("s", "p", 0.4, -0.3).unwrap();
        c.camera_orbit("s", "p", 0.4, -0.3).unwrap();
        c.camera_zoom("s", "p", 1.).unwrap();
        assert_eq!(c.take_camera_input(), [0.5, -0.5, 1.]);
        assert_eq!(c.take_camera_input(), [0.; 3]);
        c.camera_zoom("s", "p", 1.).unwrap();
        c.release_session("s");
        assert_eq!(c.take_camera_input(), [0.; 3]);
    }
    #[test]
    fn observation_contract_and_focus_lifecycle() {
        let mut c = core();
        assert!(
            c.set_camera_observation("s", "p", "a", "system", vec!["b".into()], None)
                .is_err()
        );
        assert!(
            c.set_camera_observation("s", "p", "a", "follow", vec![], Some("a".into()))
                .is_err()
        );
        c.set_camera_observation("s", "p", "a", "follow", vec![], Some("b".into()))
            .unwrap();
        c.set_camera_view("s", "p", "top").unwrap();
        assert_eq!(c.camera_observation().unwrap().mode, "follow");
        c.focus("s", "p", "a").unwrap();
        assert!(c.camera_observation().is_none());
        c.set_camera_observation("s", "p", "a", "system", vec!["a".into(), "b".into()], None)
            .unwrap();
        c.set_camera_view("s", "p", "overview").unwrap();
        assert!(c.camera_observation().is_none());
    }
    #[test]
    fn observation_json_rejects_unknown_fields() {
        assert!(
            serde_json::from_str::<CameraObservation>(
                r#"{"targetId":"a","mode":"nearby","extra":true}"#
            )
            .is_err()
        );
    }
}
