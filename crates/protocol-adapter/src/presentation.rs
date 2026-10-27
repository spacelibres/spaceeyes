// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Trusted host frame route; no command history or separate clock authority.
use crate::{decode_frame_id, decode_object_id, generated as p, ProtocolError};
#[derive(Debug)]
pub struct HostFrameRequest {
    pub reference: spaceeyes_foundation::FrameId,
    pub camera: spaceeyes_foundation::ObjectId,
    pub width: u32,
    pub height: u32,
    pub elapsed_nanos: u64,
}
pub fn decode_host_frame(frame: p::HostFrame) -> Result<HostFrameRequest, ProtocolError> {
    if frame.width == 0
        || frame.height == 0
        || frame.width > spaceeyes_rendering::MAX_CANVAS_DIMENSION
        || frame.height > spaceeyes_rendering::MAX_CANVAS_DIMENSION
        || frame.elapsed_nanos > spaceeyes_rendering::MAX_FRAME_ELAPSED_NANOS
    {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(HostFrameRequest {
        reference: decode_frame_id(frame.reference.ok_or(ProtocolError::MissingField)?)?,
        camera: decode_object_id(frame.camera.ok_or(ProtocolError::MissingField)?)?,
        width: frame.width,
        height: frame.height,
        elapsed_nanos: frame.elapsed_nanos,
    })
}
#[cfg(all(feature = "gpu", target_arch = "wasm32"))]
impl crate::ProtocolAdapter {
    pub fn install_surface(
        &mut self,
        surface: spaceeyes_rendering::gpu::BrowserSurface,
    ) -> Result<(), spaceeyes_engine::DispatchError> {
        self.dispatcher.install_surface(surface)
    }
    pub async fn present_bytes(
        &mut self,
        principal: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, ProtocolError> {
        use prost::Message;
        if bytes.len() > crate::limits::MAX_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge);
        }
        let envelope =
            p::HostFrameEnvelope::decode(bytes).map_err(|_| ProtocolError::InvalidContext)?;
        let context = envelope.context.ok_or(ProtocolError::MissingField)?;
        crate::dispatch::validate_wire_context(&context)?;
        let mut response = p::ResponseEnvelope {
            request_id: context.request_id.clone(),
            ..Default::default()
        };
        let result = self
            .present_request(principal, &context, envelope.frame)
            .await;
        match result {
            Ok((state, unresolved, width, height)) => {
                response.status = p::ResponseStatus::Completed as i32;
                response.command_sequence = self.dispatcher.command_sequence();
                response.committed_scene_revision = state.scene_revision.0;
                response.frame_sequence = state.frame_sequence;
                response.payload = Some(p::response_envelope::Payload::Presented(
                    p::FramePresented {
                        session: Some(crate::query::encode_status(&state)?),
                        width,
                        height,
                        unresolved_objects: unresolved,
                    },
                ));
            }
            Err((code, message)) => {
                response.status = p::ResponseStatus::Rejected as i32;
                response.payload = Some(p::response_envelope::Payload::Error(p::Error {
                    code: code as i32,
                    message,
                    request_id: context.request_id,
                    details: vec![],
                }));
            }
        }
        Ok(response.encode_to_vec())
    }
    async fn present_request(
        &mut self,
        principal: &str,
        context: &p::RequestContext,
        frame: Option<p::HostFrame>,
    ) -> Result<(spaceeyes_engine::SessionStatus, u64, u32, u32), (p::ErrorCode, String)> {
        self.dispatcher
            .validate_context(&context.session_id, principal, &context.request_id)
            .map_err(|e| (crate::dispatch::dispatch_error_code(&e), format!("{e:?}")))?;
        let state = self.dispatcher.session_status();
        if state.lifecycle != spaceeyes_engine::EngineState::Running {
            return Err((p::ErrorCode::EngineUnavailable, "engine not running".into()));
        }
        if context.time_generation != Some(state.clock.generation.0) {
            return Err((
                p::ErrorCode::StaleGeneration,
                "current time generation required".into(),
            ));
        }
        if context
            .expected_scene_revision
            .is_some_and(|r| r != state.scene_revision.0)
        {
            return Err((
                p::ErrorCode::RevisionConflict,
                "scene revision conflict".into(),
            ));
        }
        let request = decode_host_frame(
            frame.ok_or((p::ErrorCode::InvalidArgument, "missing host frame".into()))?,
        )
        .map_err(|e| (p::ErrorCode::InvalidArgument, format!("{e:?}")))?;
        if !self
            .dispatcher
            .engine()
            .spatial()
            .contains(&request.reference)
        {
            return Err((p::ErrorCode::UnknownFrame, "unknown reference frame".into()));
        }
        let (state, unresolved) = self
            .dispatcher
            .present_surface(
                &request.reference,
                &request.camera,
                request.width,
                request.height,
                request.elapsed_nanos,
            )
            .await
            .map_err(|e| {
                let code = match e {
                    spaceeyes_rendering::RenderError::Budget => p::ErrorCode::ResourceExceeded,
                    spaceeyes_rendering::RenderError::CameraUnavailable => {
                        p::ErrorCode::UnknownObject
                    }
                    spaceeyes_rendering::RenderError::Device(_) => p::ErrorCode::InternalError,
                    _ => p::ErrorCode::InvalidArgument,
                };
                (code, format!("{e:?}"))
            })?;
        Ok((state, unresolved, request.width, request.height))
    }
}
