// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! WASM byte transport; the same core and generated Proto contract as Native.
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::ProtocolAdapter;
use spaceeyes_time::TimeInstant;
use wasm_bindgen::prelude::*;
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
        let dispatcher = CommandDispatcher::new(Engine::new(instant), session, 4096)
            .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        let adapter =
            ProtocolAdapter::new(dispatcher).map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
        Ok(Self { adapter })
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
