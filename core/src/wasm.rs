use crate::{AssetDescriptor, AssetKind, Core, SessionPermissions, SharedCore};
use wasm_bindgen::prelude::*;

/// Host-only bridge. Plugins receive the TS SDK, never this binding.
#[wasm_bindgen]
#[derive(Default)]
pub struct WasmCore {
    core: SharedCore,
    #[cfg(feature = "browser-render")]
    renderer_stop: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
}

impl WasmCore {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Core>, String> {
        self.core.lock().map_err(|_| "CoreUnavailable".to_owned())
    }
}

impl Drop for WasmCore {
    fn drop(&mut self) {
        #[cfg(feature = "browser-render")]
        if let Some(stop) = &self.renderer_stop {
            stop.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}

#[wasm_bindgen]
impl WasmCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(feature = "browser-render")]
    pub fn start_renderer(&mut self, canvas: &str) -> Result<(), String> {
        if self.renderer_stop.is_some() {
            return Err("RendererAlreadyStarted".into());
        }
        if canvas.is_empty() || canvas.len() > 256 {
            return Err("InvalidCanvas".into());
        }
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.renderer_stop = Some(stop.clone());
        crate::renderer::create_browser_app(self.core.clone(), stop, canvas).run();
        Ok(())
    }

    #[cfg(feature = "browser-render")]
    pub fn stop_renderer(&self) {
        if let Some(stop) = &self.renderer_stop {
            stop.store(true, std::sync::atomic::Ordering::Release);
        }
    }

    pub fn open_session(
        &mut self,
        id: &str,
        plugin: &str,
        camera: bool,
        data: bool,
        time: bool,
        visual: bool,
    ) -> Result<(), String> {
        self.lock()?
            .open_session_with_permissions(
                id,
                plugin,
                SessionPermissions {
                    camera_control: camera,
                    data_publish: data,
                    time_control: time,
                    visual_control: visual,
                },
            )
            .map_err(|e| format!("{e:?}"))
    }

    pub fn register_asset(&mut self, id: &str, path: &str, kind: &str) -> Result<(), String> {
        let kind = match kind {
            "model" => AssetKind::Model,
            "texture" => AssetKind::Texture,
            _ => return Err("InvalidAsset".into()),
        };
        self.lock()?
            .register_asset(
                id,
                AssetDescriptor {
                    kind,
                    path: path.to_owned(),
                },
            )
            .map_err(|e| format!("{e:?}"))
    }

    pub fn set_visual(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        spec_json: &str,
    ) -> Result<(), String> {
        if spec_json.len() > 4096 {
            return Err("InvalidVisual".into());
        }
        let spec = serde_json::from_str(spec_json).map_err(|_| "InvalidVisual".to_owned())?;
        self.lock()?
            .set_visual(session, plugin, target, spec)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn visual_status(&self, target: &str) -> Result<String, String> {
        let core = self.lock()?;
        let status = core.visual_status(target).map_err(|e| format!("{e:?}"))?;
        serde_json::to_string(&status).map_err(|_| "InvalidVisual".to_owned())
    }

    pub fn owned_visual_status(
        &self,
        session: &str,
        plugin: &str,
        target: &str,
    ) -> Result<String, String> {
        let core = self.lock()?;
        let status = core
            .owned_visual_status(session, plugin, target)
            .map_err(|e| format!("{e:?}"))?;
        serde_json::to_string(&status).map_err(|_| "InvalidVisual".to_owned())
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
        self.lock()?
            .publish_object(session, plugin, target, state)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn remove_object(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
    ) -> Result<(), String> {
        self.lock()?
            .remove_object(session, plugin, target)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn focus(&mut self, session: &str, plugin: &str, target: &str) -> Result<(), String> {
        self.lock()?
            .focus(session, plugin, target)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn focused_object(&self) -> Result<Option<String>, String> {
        Ok(self.lock()?.focused_object().map(str::to_owned))
    }

    pub fn state_at(&self, target: &str, epoch: f64) -> Result<String, String> {
        let core = self.lock()?;
        let state = core
            .object_state_at(target, epoch)
            .map_err(|e| format!("{e:?}"))?;
        serde_json::to_string(state).map_err(|_| "InvalidState".to_owned())
    }

    pub fn seek(&mut self, session: &str, plugin: &str, epoch: f64) -> Result<(), String> {
        self.lock()?
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
        self.lock()?
            .set_playback(session, plugin, playing, rate)
            .map_err(|e| format!("{e:?}"))
    }

    pub fn tick(&mut self, elapsed: f64) -> Result<(), String> {
        self.lock()?.tick(elapsed).map_err(|e| format!("{e:?}"))
    }
    pub fn epoch(&self) -> Result<f64, String> {
        Ok(self.lock()?.clock().epoch())
    }
    pub fn playing(&self) -> Result<bool, String> {
        Ok(self.lock()?.clock().is_playing())
    }
    pub fn release_session(&mut self, session: &str) -> Result<(), String> {
        self.lock()?.release_session(session);
        Ok(())
    }
}
