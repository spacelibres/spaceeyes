use crate::{Core, SessionPermissions};
use wasm_bindgen::prelude::*;

/// Host-only bridge. Plugins receive the TS SDK, never this binding.
#[wasm_bindgen]
#[derive(Default)]
pub struct WasmCore {
    core: Core,
}

#[wasm_bindgen]
impl WasmCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open_session(
        &mut self,
        id: &str,
        plugin: &str,
        camera: bool,
        data: bool,
        time: bool,
    ) -> Result<(), String> {
        self.core
            .open_session_with_permissions(
                id,
                plugin,
                SessionPermissions {
                    camera_control: camera,
                    data_publish: data,
                    time_control: time,
                },
            )
            .map_err(|e| format!("{e:?}"))
    }

    pub fn publish_object(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        state_json: &str,
    ) -> Result<(), String> {
        if state_json.len() > 8192 {
            return Err("InvalidState: payload too large".into());
        }
        let state = serde_json::from_str(state_json)
            .map_err(|_| "InvalidState: malformed sample".to_owned())?;
        self.core
            .publish_object(session, plugin, target, state)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn remove_object(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
    ) -> Result<(), String> {
        self.core
            .remove_object(session, plugin, target)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn focus(&mut self, session: &str, plugin: &str, target: &str) -> Result<(), String> {
        self.core
            .focus(session, plugin, target)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn focused_object(&self) -> Option<String> {
        self.core.focused_object().map(str::to_owned)
    }

    pub fn state_at(&self, target: &str, epoch: f64) -> Result<String, String> {
        let state = self
            .core
            .object_state_at(target, epoch)
            .map_err(|e| format!("{e:?}"))?;
        serde_json::to_string(state).map_err(|_| "InvalidState".to_owned())
    }

    pub fn seek(&mut self, session: &str, plugin: &str, epoch: f64) -> Result<(), String> {
        self.core
            .seek(session, plugin, epoch)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn set_playback(
        &mut self,
        session: &str,
        plugin: &str,
        playing: bool,
        rate: f64,
    ) -> Result<(), String> {
        self.core
            .set_playback(session, plugin, playing, rate)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn tick(&mut self, elapsed: f64) -> Result<(), String> {
        self.core.tick(elapsed).map_err(|e| format!("{e:?}"))
    }
    pub fn epoch(&self) -> f64 {
        self.core.clock().epoch()
    }
    pub fn playing(&self) -> bool {
        self.core.clock().is_playing()
    }
    pub fn release_session(&mut self, session: &str) {
        self.core.release_session(session);
    }
}
