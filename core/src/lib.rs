//! Core-owned state, lifecycle and resource contracts, with optional Bevy display adapters.
use std::collections::{HashMap, HashSet};
pub type AnnotationRef<'a> = (&'a str, Option<&'a str>, Option<&'a [[f64; 3]]>);
pub type SharedCore = std::sync::Arc<std::sync::Mutex<Core>>;
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrajectoryStyle {
    pub origin_id: Option<String>,
    pub color_rgba: Option<[f32; 4]>,
}
#[cfg(feature = "bevy-runtime")]
mod runtime;
#[cfg(feature = "bevy-runtime")]
pub use runtime::{DisplaySettings, SceneObject, SyncReport, create_headless_app};
#[cfg(feature = "browser-render")]
mod camera_motion;
mod clock;
mod deep_space;
#[cfg(feature = "browser-render")]
mod label_visibility;
pub use deep_space::EnvironmentSpec;
mod starfield;
pub use starfield::StarfieldSpec;
#[cfg(feature = "browser-render")]
mod deep_render;
#[cfg(feature = "browser-render")]
mod face_texture;
mod orbit_lines;
mod picking;
#[cfg(feature = "browser-render")]
mod render_assets;
#[cfg(feature = "browser-render")]
mod renderer;
#[cfg(feature = "browser-render")]
mod ring_texture;
#[cfg(feature = "browser-render")]
mod screen_layout;
#[cfg(feature = "browser-render")]
mod sky_render;
mod state;
pub use clock::SimulationClock;
pub use state::ObjectState;
mod stellar_tuning;
pub use stellar_tuning::{StellarProfile, StellarTuning};
mod visuals;
pub use visuals::{
    AssetDescriptor, AssetKind, VisualAssignment, VisualPhase, VisualSpec, VisualStatus,
};
mod wasm;
pub use wasm::WasmCore;

#[derive(Debug, PartialEq, Eq)]
pub enum CoreError {
    InvalidId,
    DuplicateSession,
    DuplicateObject,
    InactiveSession,
    WrongOwner,
    PermissionDenied,
    UnknownObject,
    InvalidState,
    InvalidTime,
    OutsideCoverage,
    StaleState,
    CapacityExceeded,
    UnknownAsset,
    InvalidAsset,
    DuplicateAsset,
    InvalidVisual,
}

struct Session {
    plugin_id: String,
    permissions: SessionPermissions,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SessionPermissions {
    pub camera_control: bool,
    pub data_publish: bool,
    pub time_control: bool,
    pub visual_control: bool,
}

/// Configurable resource budgets, not a limit on the platform's scientific scope.
#[derive(Debug, Clone, Copy)]
pub struct CoreLimits {
    pub active_sessions: usize,
    pub session_history: usize,
    pub objects: usize,
}

impl Default for CoreLimits {
    fn default() -> Self {
        Self {
            active_sessions: 256,
            session_history: 65_536,
            objects: 100_000,
        }
    }
}

#[derive(Default)]
pub struct Core {
    stellar_tuning: HashMap<String, StellarTuning>,
    starfields: HashMap<(String, String), starfield::StarfieldLayer>,
    starfield_revision: u64,
    environment: Option<deep_space::EnvironmentLayer>,
    environment_status: serde_json::Value,
    environment_revision: u64,
    assets: HashMap<String, AssetDescriptor>,
    visuals: HashMap<String, VisualAssignment>,
    visual_statuses: HashMap<String, VisualStatus>,
    visual_parts: HashMap<String, HashSet<String>>,
    next_visual_revision: u64,
    limits: CoreLimits,
    sessions: HashMap<String, Session>,
    // Retired session IDs stay invalid for this core instance's lifetime.
    used_sessions: HashSet<String>,
    objects: HashMap<String, String>,
    states: HashMap<String, ObjectState>,
    focus: Option<(String, String)>,
    camera_view: String,
    focus_revision: u64,
    trajectories: HashMap<String, Vec<[f64; 3]>>,
    trajectory_epochs: HashMap<String, Vec<f64>>,
    trajectory_styles: HashMap<String, TrajectoryStyle>,
    labels: HashMap<String, String>,
    layers: HashMap<String, (bool, bool)>,
    clock: SimulationClock,
    time_owner: Option<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b":._/-".contains(&c))
}

impl Core {
    pub fn object_ids(&self) -> impl Iterator<Item = &str> {
        self.objects.keys().map(String::as_str)
    }
    pub fn with_limits(limits: CoreLimits) -> Self {
        Self {
            limits,
            ..Self::default()
        }
    }
    fn authorize(
        &self,
        session_id: &str,
        plugin_id: &str,
    ) -> Result<SessionPermissions, CoreError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or(CoreError::InactiveSession)?;
        if session.plugin_id != plugin_id {
            return Err(CoreError::WrongOwner);
        }
        Ok(session.permissions)
    }

    pub fn publish_object(
        &mut self,
        session_id: &str,
        plugin_id: &str,
        object_id: &str,
        state: ObjectState,
    ) -> Result<(), CoreError> {
        if !self.authorize(session_id, plugin_id)?.data_publish {
            return Err(CoreError::PermissionDenied);
        }
        if !valid_id(object_id) {
            return Err(CoreError::InvalidId);
        }
        state.validate()?;
        if let Some(owner) = self.objects.get(object_id)
            && owner != session_id
        {
            return Err(CoreError::WrongOwner);
        }
        if !self.objects.contains_key(object_id) && self.objects.len() >= self.limits.objects {
            return Err(CoreError::CapacityExceeded);
        }
        self.objects
            .insert(object_id.to_owned(), session_id.to_owned());
        self.states.insert(object_id.to_owned(), state);
        Ok(())
    }

    pub fn remove_object(
        &mut self,
        session_id: &str,
        plugin_id: &str,
        object_id: &str,
    ) -> Result<(), CoreError> {
        if !self.authorize(session_id, plugin_id)?.data_publish {
            return Err(CoreError::PermissionDenied);
        }
        let owner = self
            .objects
            .get(object_id)
            .ok_or(CoreError::UnknownObject)?;
        if owner != session_id {
            return Err(CoreError::WrongOwner);
        }
        self.objects.remove(object_id);
        self.trajectories.remove(object_id);
        self.trajectory_epochs.remove(object_id);
        self.trajectory_styles.remove(object_id);
        self.labels.remove(object_id);
        self.states.remove(object_id);
        self.visuals.remove(object_id);
        self.stellar_tuning.remove(object_id);
        self.visual_statuses.remove(object_id);
        self.visual_parts.remove(object_id);
        if self.focused_object() == Some(object_id) {
            self.focus = None;
        }
        Ok(())
    }

    pub fn clock(&self) -> &SimulationClock {
        &self.clock
    }
    pub fn tick(&mut self, elapsed_seconds: f64) -> Result<(), CoreError> {
        self.clock.advance(elapsed_seconds)
    }
    pub fn seek(&mut self, session_id: &str, plugin_id: &str, epoch: f64) -> Result<(), CoreError> {
        if !self.authorize(session_id, plugin_id)?.time_control {
            return Err(CoreError::PermissionDenied);
        }
        self.clock.seek(epoch)?;
        self.time_owner = Some(session_id.to_owned());
        Ok(())
    }
    pub fn set_playback(
        &mut self,
        session_id: &str,
        plugin_id: &str,
        playing: bool,
        rate: f64,
    ) -> Result<(), CoreError> {
        if !self.authorize(session_id, plugin_id)?.time_control {
            return Err(CoreError::PermissionDenied);
        }
        self.clock.set_rate(rate)?;
        self.clock.set_playing(playing);
        self.time_owner = Some(session_id.to_owned());
        Ok(())
    }
    pub fn set_object_state(
        &mut self,
        session_id: &str,
        object_id: &str,
        state: ObjectState,
    ) -> Result<(), CoreError> {
        if !self.sessions.contains_key(session_id) {
            return Err(CoreError::InactiveSession);
        }
        let owner = self
            .objects
            .get(object_id)
            .ok_or(CoreError::UnknownObject)?;
        if owner != session_id {
            return Err(CoreError::WrongOwner);
        }
        state.validate()?;
        self.states.insert(object_id.to_owned(), state);
        Ok(())
    }

    pub fn object_state_at(&self, object_id: &str, epoch: f64) -> Result<&ObjectState, CoreError> {
        if !epoch.is_finite() {
            return Err(CoreError::InvalidTime);
        }
        if !self.objects.contains_key(object_id) {
            return Err(CoreError::UnknownObject);
        }
        let state = self.states.get(object_id).ok_or(CoreError::StaleState)?;
        if epoch < state.coverage_tdb_seconds[0] || epoch > state.coverage_tdb_seconds[1] {
            return Err(CoreError::OutsideCoverage);
        }
        if epoch != state.epoch_tdb_seconds {
            return Err(CoreError::StaleState);
        }
        Ok(state)
    }

    /// Host-only operation; never expose session grants directly to plugins.
    pub fn open_session(
        &mut self,
        id: &str,
        plugin_id: &str,
        camera_control: bool,
    ) -> Result<(), CoreError> {
        self.open_session_with_permissions(
            id,
            plugin_id,
            SessionPermissions {
                camera_control,
                ..Default::default()
            },
        )
    }

    pub fn open_session_with_permissions(
        &mut self,
        id: &str,
        plugin_id: &str,
        permissions: SessionPermissions,
    ) -> Result<(), CoreError> {
        if !valid_id(id) || !valid_id(plugin_id) {
            return Err(CoreError::InvalidId);
        }
        if self.used_sessions.contains(id) {
            return Err(CoreError::DuplicateSession);
        }
        if self.used_sessions.len() >= self.limits.session_history
            || self.sessions.len() >= self.limits.active_sessions
        {
            return Err(CoreError::CapacityExceeded);
        }
        self.used_sessions.insert(id.to_owned());
        self.sessions.insert(
            id.to_owned(),
            Session {
                plugin_id: plugin_id.to_owned(),
                permissions,
            },
        );
        Ok(())
    }

    /// Internal registration only. A data-publishing SDK must enforce its own grant before calling.
    pub fn register_object(&mut self, session_id: &str, object_id: &str) -> Result<(), CoreError> {
        if !self.sessions.contains_key(session_id) {
            return Err(CoreError::InactiveSession);
        }
        if !valid_id(object_id) {
            return Err(CoreError::InvalidId);
        }
        if self.objects.contains_key(object_id) {
            return Err(CoreError::DuplicateObject);
        }
        if self.objects.len() >= self.limits.objects {
            return Err(CoreError::CapacityExceeded);
        }
        self.objects
            .insert(object_id.to_owned(), session_id.to_owned());
        Ok(())
    }

    /// Records an accepted intent; a Bevy adapter must apply the actual camera movement.
    pub fn focus(
        &mut self,
        session_id: &str,
        plugin_id: &str,
        target_id: &str,
    ) -> Result<(), CoreError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or(CoreError::InactiveSession)?;
        if session.plugin_id != plugin_id {
            return Err(CoreError::WrongOwner);
        }
        if !session.permissions.camera_control {
            return Err(CoreError::PermissionDenied);
        }
        if !valid_id(target_id) {
            return Err(CoreError::InvalidId);
        }
        if !self.objects.contains_key(target_id) {
            return Err(CoreError::UnknownObject);
        }
        self.focus_revision = self
            .focus_revision
            .checked_add(1)
            .ok_or(CoreError::CapacityExceeded)?;
        self.focus = Some((session_id.to_owned(), target_id.to_owned()));
        Ok(())
    }

    pub fn set_annotation(
        &mut self,
        session: &str,
        plugin: &str,
        id: &str,
        points: Option<Vec<[f64; 3]>>,
        label: Option<String>,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self.objects.get(id).ok_or(CoreError::UnknownObject)? != session {
            return Err(CoreError::WrongOwner);
        }
        if let Some(points) = points {
            let used: usize = self
                .trajectories
                .iter()
                .filter(|(key, _)| {
                    key.as_str() != id
                        && self.objects.get(*key).is_some_and(|owner| owner == session)
                })
                .map(|(_, points)| points.len())
                .sum();
            if used.saturating_add(points.len()) > 4096
                || points.iter().flatten().any(|n| !n.is_finite())
            {
                return Err(CoreError::InvalidVisual);
            }
            self.trajectories.insert(id.to_owned(), points);
            self.trajectory_epochs.remove(id);
            self.trajectory_styles.remove(id);
        }
        if let Some(label) = label {
            if label.chars().count() > 256 || label.chars().any(|c| c.is_control()) {
                return Err(CoreError::InvalidVisual);
            }
            self.labels.insert(id.to_owned(), label);
        }
        Ok(())
    }
    pub fn set_timed_trajectory(
        &mut self,
        session: &str,
        plugin: &str,
        id: &str,
        points: Vec<[f64; 3]>,
        epochs: Vec<f64>,
    ) -> Result<(), CoreError> {
        self.set_trajectory_with_style(
            session,
            plugin,
            id,
            points,
            epochs,
            TrajectoryStyle::default(),
        )
    }
    pub fn set_trajectory_with_style(
        &mut self,
        session: &str,
        plugin: &str,
        id: &str,
        points: Vec<[f64; 3]>,
        epochs: Vec<f64>,
        style: TrajectoryStyle,
    ) -> Result<(), CoreError> {
        if let Some(origin) = &style.origin_id {
            if origin == id {
                return Err(CoreError::InvalidVisual);
            }
            if self.objects.get(origin).ok_or(CoreError::UnknownObject)? != session {
                return Err(CoreError::WrongOwner);
            }
        }
        if style
            .color_rgba
            .is_some_and(|c| c.iter().any(|n| !n.is_finite() || !(0.0..=1.0).contains(n)))
        {
            return Err(CoreError::InvalidVisual);
        }
        if epochs.len() != points.len()
            || epochs.len() == 1
            || epochs.iter().any(|t| !t.is_finite())
            || epochs.windows(2).any(|w| w[0] >= w[1])
        {
            return Err(CoreError::InvalidVisual);
        }
        self.set_annotation(session, plugin, id, Some(points), None)?;
        self.trajectory_epochs.insert(id.to_owned(), epochs);
        self.trajectory_styles.insert(id.to_owned(), style);
        Ok(())
    }
    pub fn trajectory_epochs(&self, id: &str) -> Option<&[f64]> {
        self.trajectory_epochs.get(id).map(Vec::as_slice)
    }
    pub fn trajectory_style(&self, id: &str) -> Option<&TrajectoryStyle> {
        self.trajectory_styles.get(id)
    }
    pub fn set_layers(
        &mut self,
        session: &str,
        plugin: &str,
        labels: bool,
        trajectories: bool,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        self.layers
            .insert(session.to_owned(), (labels, trajectories));
        Ok(())
    }
    pub fn annotations(&self) -> impl Iterator<Item = AnnotationRef<'_>> {
        self.objects.iter().map(|(id, owner)| {
            let (labels, trajectories) = self.layers.get(owner).copied().unwrap_or((true, true));
            (
                id.as_str(),
                if labels {
                    self.labels.get(id).map(String::as_str)
                } else {
                    None
                },
                if trajectories {
                    self.trajectories.get(id).map(Vec::as_slice)
                } else {
                    None
                },
            )
        })
    }

    pub fn focus_revision(&self) -> u64 {
        self.focus_revision
    }
    pub fn camera_view(&self) -> &str {
        &self.camera_view
    }
    pub fn set_camera_view(
        &mut self,
        session_id: &str,
        plugin_id: &str,
        mode: &str,
    ) -> Result<(), CoreError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or(CoreError::InactiveSession)?;
        if session.plugin_id != plugin_id {
            return Err(CoreError::WrongOwner);
        }
        if !session.permissions.camera_control {
            return Err(CoreError::PermissionDenied);
        }
        if !["overview", "top", "front", "side", "orbit"].contains(&mode) {
            return Err(CoreError::InvalidState);
        }
        if mode == "overview" {
            self.focus = None;
        }
        self.camera_view = mode.to_owned();
        Ok(())
    }

    pub fn focused_object(&self) -> Option<&str> {
        self.focus.as_ref().map(|(_, target)| target.as_str())
    }
    #[cfg(feature = "browser-render")]
    pub(crate) fn camera_zoom_to_overview(&mut self) {
        self.focus = None;
        self.camera_view = "overview".into();
    }

    pub fn release_session(&mut self, id: &str) {
        if self.environment.as_ref().is_some_and(|v| v.owner == id) {
            self.environment = None;
            self.environment_status = serde_json::json!({"phase":"disabled"});
        }
        self.starfields.retain(|(session, _), _| session != id);
        self.layers.remove(id);
        self.trajectories
            .retain(|object, _| self.objects.get(object).is_some_and(|owner| owner != id));
        self.labels
            .retain(|object, _| self.objects.get(object).is_some_and(|owner| owner != id));
        if self.time_owner.as_deref() == Some(id) {
            self.clock.set_playing(false);
            self.time_owner = None;
        }
        self.sessions.remove(id);
        self.objects.retain(|_, owner| owner != id);
        self.trajectory_epochs
            .retain(|object, _| self.objects.contains_key(object));
        self.trajectory_styles
            .retain(|object, _| self.objects.contains_key(object));
        self.states
            .retain(|object_id, _| self.objects.contains_key(object_id));
        self.visuals
            .retain(|object_id, _| self.objects.contains_key(object_id));
        self.stellar_tuning
            .retain(|object_id, _| self.objects.contains_key(object_id));
        self.visual_statuses
            .retain(|object_id, _| self.objects.contains_key(object_id));
        self.visual_parts
            .retain(|object_id, _| self.objects.contains_key(object_id));
        if self
            .focus
            .as_ref()
            .is_some_and(|(owner, target)| owner == id || !self.objects.contains_key(target))
        {
            self.focus = None;
        }
    }
}

#[cfg(test)]
mod annotation_tests {
    use super::*;
    #[test]
    fn annotations_enforce_owner_budget_layers_and_cleanup() {
        let mut c = Core::default();
        for session in ["a", "b"] {
            c.open_session_with_permissions(
                session,
                session,
                SessionPermissions {
                    visual_control: true,
                    ..Default::default()
                },
            )
            .unwrap();
            c.register_object(session, session).unwrap();
        }
        assert_eq!(
            c.set_annotation("a", "a", "b", None, Some("bad".into())),
            Err(CoreError::WrongOwner)
        );
        assert_eq!(
            c.set_annotation("a", "a", "a", Some(vec![[0.; 3]; 4097]), None),
            Err(CoreError::InvalidVisual)
        );
        c.set_annotation("a", "a", "a", Some(vec![[0.; 3]; 2]), Some("Earth".into()))
            .unwrap();
        c.set_layers("a", "a", false, false).unwrap();
        let (_, label, trajectory) = c.annotations().find(|(id, _, _)| *id == "a").unwrap();
        assert!(label.is_none() && trajectory.is_none());
        c.release_session("a");
        assert!(!c.labels.contains_key("a") && !c.trajectories.contains_key("a"));
    }
}

#[cfg(feature = "browser-render")]
mod stellar_render;

#[cfg(feature = "browser-render")]
mod solar_surface;
