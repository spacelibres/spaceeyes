use crate::{AssetDescriptor, AssetKind, Core, SessionPermissions, SharedCore};
use wasm_bindgen::prelude::*;

/// Host-only bridge. Plugins receive the TS SDK, never this binding.
#[wasm_bindgen]
#[derive(Default)]
pub struct WasmCore {
    core: SharedCore,
    picks: crate::picking::SharedPickFrame,
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
        crate::renderer::create_browser_app(self.core.clone(), stop, canvas, self.picks.clone())
            .run();
        Ok(())
    }

    #[cfg(feature = "browser-render")]
    pub fn stop_renderer(&self) {
        if let Some(stop) = &self.renderer_stop {
            stop.store(true, std::sync::atomic::Ordering::Release);
        }
        if let Ok(mut frame) = self.picks.lock() {
            *frame = Default::default();
        }
    }

    /// Host input only: normalized canvas coordinates, not a plugin capability.
    pub fn pick_object(&self, u: f64, v: f64) -> Result<Option<String>, String> {
        if !u.is_finite()
            || !v.is_finite()
            || !(0.0..=1.0).contains(&u)
            || !(0.0..=1.0).contains(&v)
        {
            return Err("InvalidViewportPoint".into());
        }
        #[cfg(feature = "browser-render")]
        if self
            .renderer_stop
            .as_ref()
            .is_none_or(|stop| stop.load(std::sync::atomic::Ordering::Acquire))
        {
            return Ok(None);
        }
        let candidate = self
            .picks
            .lock()
            .map_err(|_| "RendererUnavailable".to_owned())?
            .pick(u as f32, v as f32)
            .map(str::to_owned);
        let Some(id) = candidate else {
            return Ok(None);
        };
        let core = self.lock()?;
        if core.object_state_at(&id, core.clock().epoch()).is_err()
            || core
                .visual_status(&id)
                .ok()
                .flatten()
                .is_some_and(|status| {
                    matches!(
                        status.phase,
                        crate::VisualPhase::Failed | crate::VisualPhase::Suspended
                    )
                })
        {
            return Ok(None);
        }
        Ok(Some(id))
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

    pub fn tdb_to_utc(&self, tdb_seconds: f64) -> Result<f64, String> {
        if !tdb_seconds.is_finite() || tdb_seconds.abs() > 1e12 {
            return Err("InvalidTime".into());
        }
        Ok(hifitime::Epoch::from_tdb_seconds(tdb_seconds).to_unix_seconds())
    }
    pub fn utc_to_tdb(&self, unix_seconds: f64) -> Result<f64, String> {
        if !unix_seconds.is_finite() || unix_seconds.abs() > 1e12 {
            return Err("InvalidTime".into());
        }
        Ok(hifitime::Epoch::from_unix_seconds(unix_seconds).to_tdb_seconds())
    }
    pub fn trajectory(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        points_json: &str,
    ) -> Result<(), String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Timed {
            points: Vec<[f64; 3]>,
            epochs: Vec<f64>,
            origin_id: Option<String>,
            color_rgba: Option<[f32; 4]>,
        }
        #[derive(serde::Deserialize)]
        #[serde(untagged)]
        enum Payload {
            Static(Vec<[f64; 3]>),
            Timed(Timed),
        }
        if points_json.len() > 1024 * 1024 {
            return Err("InvalidVisual".into());
        }
        let payload = serde_json::from_str(points_json).map_err(|_| "InvalidVisual".to_owned())?;
        let mut core = self.lock()?;
        match payload {
            Payload::Static(points) => {
                core.set_annotation(session, plugin, target, Some(points), None)
            }
            Payload::Timed(Timed {
                points,
                epochs,
                origin_id,
                color_rgba,
            }) => core.set_trajectory_with_style(
                session,
                plugin,
                target,
                points,
                epochs,
                crate::TrajectoryStyle {
                    origin_id,
                    color_rgba,
                },
            ),
        }
        .map_err(|e| format!("{e:?}"))
    }
    pub fn label(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        text: &str,
    ) -> Result<(), String> {
        self.lock()?
            .set_annotation(session, plugin, target, None, Some(text.to_owned()))
            .map_err(|e| format!("{e:?}"))
    }
    pub fn layers(
        &mut self,
        session: &str,
        plugin: &str,
        labels: bool,
        trajectories: bool,
    ) -> Result<(), String> {
        self.lock()?
            .set_layers(session, plugin, labels, trajectories)
            .map_err(|e| format!("{e:?}"))
    }
    pub fn camera_fov(&mut self, session: &str, plugin: &str, degrees: f32) -> Result<(), String> {
        self.lock()?
            .set_camera_fov(session, plugin, degrees)
            .map_err(|e| format!("{e:?}"))
    }
    pub fn camera_fov_degrees(&self) -> Result<f32, String> {
        Ok(self.lock()?.camera_fov_degrees())
    }
    pub fn camera_view(&mut self, session: &str, plugin: &str, mode: &str) -> Result<(), String> {
        self.lock()?
            .set_camera_view(session, plugin, mode)
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

    pub fn tune_stellar(
        &mut self,
        session: &str,
        plugin: &str,
        target: &str,
        json: &str,
    ) -> Result<(), String> {
        if json.len() > 32768 {
            return Err("InvalidVisual".into());
        }
        let tuning = serde_json::from_str(json).map_err(|_| "InvalidVisual".to_owned())?;
        self.lock()?
            .tune_stellar(session, plugin, target, tuning)
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
    pub fn set_starfield(
        &mut self,
        plugin: &str,
        session: &str,
        layer: &str,
        payload: Option<String>,
    ) -> Result<(), String> {
        let spec = payload
            .map(|json| serde_json::from_str::<crate::StarfieldSpec>(&json))
            .transpose()
            .map_err(|e| e.to_string())?;
        self.lock()?
            .set_starfield(plugin, session, layer, spec)
            .map_err(|e| format!("{e:?}"))
    }
    pub fn set_environment(
        &mut self,
        plugin: &str,
        session: &str,
        payload: Option<String>,
    ) -> Result<(), String> {
        let spec = payload
            .map(|json| serde_json::from_str::<crate::EnvironmentSpec>(&json))
            .transpose()
            .map_err(|e| e.to_string())?;
        self.lock()?
            .set_environment(plugin, session, spec)
            .map_err(|e| format!("{e:?}"))
    }
    pub fn environment_status(&self) -> Result<String, String> {
        Ok(self.lock()?.environment_status.to_string())
    }
    pub fn starfield_count(&self) -> Result<usize, String> {
        Ok(self.lock()?.starfield_count())
    }
    pub fn release_session(&mut self, session: &str) -> Result<(), String> {
        self.lock()?.release_session(session);
        Ok(())
    }
}

#[cfg(test)]
mod picking_tests {
    use super::*;
    use crate::picking::{PickFrame, PickShape, PickTarget};
    #[test]
    fn host_pick_revalidates_failed_removed_objects_and_stopped_renderer() {
        let mut bridge = WasmCore::new();
        #[cfg(feature = "browser-render")]
        {
            bridge.renderer_stop = Some(std::sync::Arc::new(std::sync::atomic::AtomicBool::new(
                false,
            )));
        }
        bridge
            .open_session("s", "source.test", false, true, false, true)
            .unwrap();
        bridge.publish_object("s", "source.test", "earth", r#"{"positionKm":[0,0,0],"radiusKm":1,"epochTdbSeconds":0,"coverageTdbSeconds":[0,1],"frame":"ICRF","source":"test"}"#).unwrap();
        *bridge.picks.lock().unwrap() = PickFrame {
            viewport: [100., 100.],
            targets: vec![PickTarget {
                id: "earth".into(),
                depth: 1.,
                shape: PickShape::Disc {
                    center: [50., 50.],
                    radius: 10.,
                },
            }],
        };
        assert_eq!(
            bridge.pick_object(0.5, 0.5).unwrap().as_deref(),
            Some("earth")
        );
        assert!(bridge.pick_object(f64::NAN, 0.5).is_err());
        bridge
            .set_visual("s", "source.test", "earth", r#"{"kind":"sphere"}"#)
            .unwrap();
        {
            let mut core = bridge.lock().unwrap();
            let revision = core.visual_assignment("earth").unwrap().revision;
            core.record_visual_status("earth", revision, crate::VisualPhase::Failed, None);
        }
        assert_eq!(bridge.pick_object(0.5, 0.5).unwrap(), None);
        bridge.release_session("s").unwrap();
        assert_eq!(bridge.pick_object(0.5, 0.5).unwrap(), None);
        #[cfg(feature = "browser-render")]
        {
            bridge.stop_renderer();
            assert_eq!(bridge.pick_object(0.5, 0.5).unwrap(), None);
            assert!(bridge.picks.lock().unwrap().targets.is_empty());
        }
    }
}
