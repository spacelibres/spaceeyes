//! Core-owned lifecycle and object identity. No rendering or scientific computation here.
use std::collections::{HashMap, HashSet};

#[derive(Debug, PartialEq, Eq)]
pub enum CoreError {
    InvalidId,
    DuplicateSession,
    DuplicateObject,
    InactiveSession,
    WrongOwner,
    PermissionDenied,
    UnknownObject,
}

struct Session {
    plugin_id: String,
    camera_control: bool,
}

#[derive(Default)]
pub struct Core {
    sessions: HashMap<String, Session>,
    // Retired session IDs stay invalid for this core instance's lifetime.
    used_sessions: HashSet<String>,
    objects: HashMap<String, String>,
    focus: Option<(String, String)>,
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
    /// Host-only operation; never expose session grants directly to plugins.
    pub fn open_session(
        &mut self,
        id: &str,
        plugin_id: &str,
        camera_control: bool,
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
                camera_control,
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
        if !session.camera_control {
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
        self.sessions.remove(id);
        self.objects.retain(|_, owner| owner != id);
        if self
            .focus
            .as_ref()
            .is_some_and(|(owner, target)| owner == id || !self.objects.contains_key(target))
        {
            self.focus = None;
        }
    }
}
