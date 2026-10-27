// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! WASM byte transport; the same core and generated Proto contract as Native.
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::ProtocolAdapter;
use spaceeyes_time::TimeInstant;
use wasm_bindgen::prelude::*;
fn dispatcher(engine: Engine, session: String) -> Result<CommandDispatcher, JsValue> {
    #[cfg(all(feature = "browser", target_arch = "wasm32"))]
    {
        let clock = Box::new(|| {
            web_sys::window()
                .and_then(|window| window.performance())
                .map(|performance| performance.now() as u64)
                .unwrap_or(0)
        });
        CommandDispatcher::with_upload_clock(engine, session, 4096, clock)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    #[cfg(not(all(feature = "browser", target_arch = "wasm32")))]
    {
        CommandDispatcher::new(engine, session, 4096)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
}

#[wasm_bindgen]
pub struct WasmEngine {
    adapter: ProtocolAdapter,
}
#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(
        session: String,
        scale: String,
        epoch: String,
        seconds: i64,
        nanos: u32,
    ) -> Result<WasmEngine, JsValue> {
        let instant = TimeInstant::new(scale, epoch, seconds, nanos)
            .ok_or_else(|| JsValue::from_str("invalid explicit time"))?;
        let dispatcher = dispatcher(Engine::new(instant), session)?;
        let adapter =
            ProtocolAdapter::new(dispatcher).map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        Ok(Self { adapter })
    }
    /// Restore a new session from a verified project file. The file digest is
    /// checked before decoding; raw protobuf is rejected as an unverified file.
    /// Fresh handles and revisions are created; no GPU handles, tasks or uploads
    /// are restored.
    pub fn from_project(session: String, bytes: &[u8]) -> Result<WasmEngine, JsValue> {
        let project = spaceeyes_protocol_adapter::decode_project_file(bytes)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        let engine = Engine::restore_project(&project, &[])
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        let dispatcher = dispatcher(engine, session)?;
        let adapter =
            ProtocolAdapter::new(dispatcher).map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        Ok(Self { adapter })
    }
    /// Wrap an exported `ProjectSnapshot` payload in the verified file container.
    #[wasm_bindgen(js_name = "encodeProjectFile")]
    pub fn encode_project_file(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        spaceeyes_protocol_adapter::wrap_project_bytes(bytes)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    /// Wrap an exported `ProjectSnapshot` payload with host wall-clock metadata.
    #[wasm_bindgen(js_name = "encodeProjectFileWithTime")]
    pub fn encode_project_file_with_time(
        bytes: &[u8],
        project_id: String,
        updated_ms: f64,
    ) -> Result<Vec<u8>, JsValue> {
        let nanos = updated_ms * 1_000_000.0;
        if !nanos.is_finite() || nanos < 0.0 || nanos > i64::MAX as f64 {
            return Err(JsValue::from_str("invalid wall-clock timestamp"));
        }
        let nanos = nanos as i64;
        let manifest = spaceeyes_protocol_adapter::ProjectManifest {
            project_id,
            created_at_unix_nanos: nanos,
            updated_at_unix_nanos: nanos,
        };
        spaceeyes_protocol_adapter::wrap_project_bytes_with_manifest(bytes, &manifest)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    /// Validate a project file without creating or replacing a session.
    #[wasm_bindgen(js_name = "validateProjectFile")]
    pub fn validate_project_file(bytes: &[u8]) -> Result<(), JsValue> {
        spaceeyes_protocol_adapter::decode_project_file(bytes)
            .map(|_| ())
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    /// Call from an authenticated host; this transport performs no identity authentication.
    pub fn submit(&mut self, principal_scope: &str, bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        self.adapter
            .submit_bytes(principal_scope, bytes)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    /// Read-only transport; host authentication and authorization remain required.
    pub fn query(&self, principal_scope: &str, bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
        self.adapter
            .query_bytes(principal_scope, bytes)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    #[cfg(all(feature = "browser", target_arch = "wasm32"))]
    pub async fn attach_canvas(
        &mut self,
        canvas: web_sys::HtmlCanvasElement,
    ) -> Result<(), JsValue> {
        console_error_panic_hook::set_once();
        let surface = spaceeyes_rendering::gpu::BrowserSurface::new(canvas)
            .await
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        self.adapter
            .install_surface(surface)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
    #[cfg(all(feature = "browser", target_arch = "wasm32"))]
    pub async fn present(
        &mut self,
        principal_scope: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        self.adapter
            .present_bytes(principal_scope, bytes)
            .await
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))
    }
}
