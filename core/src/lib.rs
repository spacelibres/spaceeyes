//! Core-owned lifecycle and object identity. No rendering or scientific computation here.
use std::collections::{HashMap, HashSet};
mod clock;
mod state;
pub use clock::SimulationClock;
pub use state::ObjectState;
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
}

#[derive(Default)]
pub struct Core {
    sessions: HashMap<String, Session>,
    // Retired session IDs stay invalid for this core instance's lifetime.
    used_sessions: HashSet<String>,
    objects: HashMap<String, String>,
    states: HashMap<String, ObjectState>,
    focus: Option<(String, String)>,
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
        self.states.remove(object_id);
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
        if !self.used_sessions.insert(id.to_owned()) {
            return Err(CoreError::DuplicateSession);
        }
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
        self.focus = Some((session_id.to_owned(), target_id.to_owned()));
        Ok(())
    }

    pub fn focused_object(&self) -> Option<&str> {
        self.focus.as_ref().map(|(_, target)| target.as_str())
    }

    pub fn release_session(&mut self, id: &str) {
        if self.time_owner.as_deref() == Some(id) {
            self.clock.set_playing(false);
            self.time_owner = None;
        }
        self.sessions.remove(id);
        self.objects.retain(|_, owner| owner != id);
        self.states
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
