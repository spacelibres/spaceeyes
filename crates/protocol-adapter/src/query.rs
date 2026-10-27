// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded read-only protocol; queries never enter command history or mutate Engine.
use crate::dispatch::{dispatch_error_code, validate_wire_context};
use crate::{decode_frame_id, encode_instant, generated as p, ProtocolAdapter, ProtocolError};
use prost::Message;
use spaceeyes_engine::{EngineState, SessionStatus};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};

pub(crate) fn decode_transform(value: p::RigidTransform) -> Result<RigidTransform, ProtocolError> {
    let t = value.translation_m.ok_or(ProtocolError::MissingField)?;
    let q = value.rotation.ok_or(ProtocolError::MissingField)?;
    RigidTransform::new(
        Vec3d {
            x: t.x,
            y: t.y,
            z: t.z,
        },
        Quatd {
            w: q.w,
            x: q.x,
            y: q.y,
            z: q.z,
        },
    )
    .map_err(|_| ProtocolError::InvalidContext)
}
fn encode_transform(value: RigidTransform) -> p::RigidTransform {
    p::RigidTransform {
        translation_m: Some(p::Vector3d {
            x: value.translation_m.x,
            y: value.translation_m.y,
            z: value.translation_m.z,
        }),
        rotation: Some(p::Quaterniond {
            w: value.rotation.w,
            x: value.rotation.x,
            y: value.rotation.y,
            z: value.rotation.z,
        }),
    }
}
pub(crate) fn encode_status(s: &SessionStatus) -> Result<p::SessionStatus, ProtocolError> {
    let rate = s.clock.rate;
    Ok(p::SessionStatus {
        lifecycle: match s.lifecycle {
            EngineState::Ready => p::EngineLifecycle::Ready,
            EngineState::Running => p::EngineLifecycle::Running,
            EngineState::Stopped => p::EngineLifecycle::Stopped,
        } as i32,
        clock: Some(p::ClockState {
            instant: Some(encode_instant(&s.clock.instant)?),
            mode: match s.clock.mode {
                spaceeyes_time::ClockMode::Paused => p::PlaybackMode::Paused,
                spaceeyes_time::ClockMode::Playing => p::PlaybackMode::Playing,
            } as i32,
            rate: f64::from(rate.numerator()) / f64::from(rate.denominator()),
            generation: s.clock.generation.0,
            revision: s.clock.revision,
            rate_numerator: rate.numerator(),
            rate_denominator: rate.denominator(),
        }),
        scene_revision: s.scene_revision.0,
        frame_graph_revision: s.frame_graph_revision.0,
        resource_revision: s.resource_revision,
        frame_sequence: s.frame_sequence,
        object_count: s.object_count,
        resource_used_bytes: s.resource_used_bytes,
    })
}
fn rejection(id: &str, code: p::ErrorCode, message: String) -> p::ResponseEnvelope {
    p::ResponseEnvelope {
        request_id: id.to_owned(),
        status: p::ResponseStatus::Rejected as i32,
        payload: Some(p::response_envelope::Payload::Error(p::Error {
            code: code as i32,
            message,
            request_id: id.to_owned(),
            details: vec![],
        })),
        ..Default::default()
    }
}
impl ProtocolAdapter {
    /// Host must supply an authenticated, authorized principal; this only validates shape/session.
    pub fn query_bytes(
        &self,
        principal_scope: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, ProtocolError> {
        if bytes.len() > crate::limits::MAX_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge);
        }
        let envelope =
            p::QueryEnvelope::decode(bytes).map_err(|_| ProtocolError::InvalidContext)?;
        let id = envelope
            .context
            .as_ref()
            .map(|c| c.request_id.clone())
            .unwrap_or_default();
        let result = self.query_envelope(principal_scope, envelope);
        let response = match result {
            Ok(r) => r,
            Err(error) => rejection(
                &id,
                if error == ProtocolError::UnsupportedVersion {
                    p::ErrorCode::UnsupportedVersion
                } else {
                    p::ErrorCode::InvalidArgument
                },
                format!("{error:?}"),
            ),
        };
        Ok(response.encode_to_vec())
    }
    fn query_envelope(
        &self,
        principal_scope: &str,
        envelope: p::QueryEnvelope,
    ) -> Result<p::ResponseEnvelope, ProtocolError> {
        let context = envelope.context.ok_or(ProtocolError::MissingField)?;
        validate_wire_context(&context)?;
        let dispatcher = self.dispatcher();
        if let Err(error) =
            dispatcher.validate_context(&context.session_id, principal_scope, &context.request_id)
        {
            return Ok(rejection(
                &context.request_id,
                dispatch_error_code(&error),
                format!("{error:?}"),
            ));
        }
        let state = dispatcher.session_status();
        if context
            .time_generation
            .is_some_and(|g| g != state.clock.generation.0)
        {
            return Ok(rejection(
                &context.request_id,
                p::ErrorCode::StaleGeneration,
                "stale time generation".into(),
            ));
        }
        if context
            .expected_scene_revision
            .is_some_and(|r| r != state.scene_revision.0)
        {
            return Ok(rejection(
                &context.request_id,
                p::ErrorCode::RevisionConflict,
                "scene revision conflict".into(),
            ));
        }
        let payload = match envelope.payload.ok_or(ProtocolError::MissingField)? {
            p::query_envelope::Payload::Capabilities(_) => {
                use crate::limits::*;
                p::response_envelope::Payload::Capabilities(p::Capabilities {
                    protocol_version: Some(p::ProtocolVersion {
                        major: PROTOCOL_MAJOR,
                        minor: PROTOCOL_MINOR,
                        schema_id: SCHEMA_ID.into(),
                    }),
                    operations: OPERATIONS.iter().map(|s| (*s).into()).collect(),
                    limits: Some(p::ProtocolLimits {
                        max_message_bytes: MAX_MESSAGE_BYTES as u32,
                        max_identifier_bytes: MAX_IDENTIFIER_BYTES as u32,
                        max_scene_commands: MAX_SCENE_COMMANDS as u32,
                        max_object_resources: MAX_OBJECT_RESOURCES as u32,
                        max_texture_dimension: spaceeyes_geometry::MAX_TEXTURE_DIMENSION,
                        max_mesh_vertices: spaceeyes_geometry::MAX_VERTICES as u32,
                        max_mesh_indices: spaceeyes_geometry::MAX_INDICES as u32,
                        command_history_capacity: dispatcher.command_history_capacity() as u64,
                        command_history_remaining: dispatcher.command_history_remaining() as u64,
                    }),
                })
            }
            p::query_envelope::Payload::SessionStatus(_) => {
                p::response_envelope::Payload::Session(encode_status(&state)?)
            }
            p::query_envelope::Payload::ResolveFrame(query) => {
                let source = decode_frame_id(query.source.ok_or(ProtocolError::MissingField)?)?;
                let target = decode_frame_id(query.target.ok_or(ProtocolError::MissingField)?)?;
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                let transform =
                    match dispatcher
                        .engine()
                        .resolve_frame(&source, &target, &state.clock.instant)
                    {
                        Ok(t) => t,
                        Err(error) => {
                            return Ok(rejection(
                                &context.request_id,
                                dispatch_error_code(&spaceeyes_engine::DispatchError::Spatial(
                                    error.clone(),
                                )),
                                format!("{error:?}"),
                            ))
                        }
                    };
                p::response_envelope::Payload::Frame(p::FrameResolution {
                    source: Some(p::FrameId {
                        value: source.as_str().into(),
                    }),
                    target: Some(p::FrameId {
                        value: target.as_str().into(),
                    }),
                    instant: Some(encode_instant(&state.clock.instant)?),
                    transform: Some(encode_transform(transform)),
                    frame_graph_revision: state.frame_graph_revision.0,
                })
            }
        };
        Ok(p::ResponseEnvelope {
            request_id: context.request_id,
            status: p::ResponseStatus::Completed as i32,
            payload: Some(payload),
            command_sequence: dispatcher.command_sequence(),
            committed_scene_revision: state.scene_revision.0,
            frame_sequence: state.frame_sequence,
        })
    }
}
