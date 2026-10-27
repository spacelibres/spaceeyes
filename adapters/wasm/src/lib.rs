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
}
