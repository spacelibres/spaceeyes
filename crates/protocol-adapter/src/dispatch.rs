// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use crate::{
    decode_frame_id, decode_instant, decode_object_id, decode_resource_id, encode_instant,
    generated as p, ProtocolError,
};
use prost::Message;
use spaceeyes_engine::{Command, CommandDispatcher, DispatchError};
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{CameraState, SceneCommand, SceneObject, Sphere};

pub struct ProtocolAdapter {
    dispatcher: CommandDispatcher,
}
impl ProtocolAdapter {
    pub fn new(dispatcher: CommandDispatcher) -> Result<Self, ProtocolError> {
        encode_instant(dispatcher.engine().clock().instant())?;
        Ok(Self { dispatcher })
    }
    pub fn dispatcher(&self) -> &CommandDispatcher {
        &self.dispatcher
    }
    /// `principal_scope` comes from host authentication, never the wire payload.
    pub fn submit_bytes(
        &mut self,
        principal_scope: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, ProtocolError> {
        if bytes.len() > 1024 * 1024 {
            return Err(ProtocolError::MessageTooLarge);
        }
        let envelope =
            p::CommandEnvelope::decode(bytes).map_err(|_| ProtocolError::InvalidContext)?;
        let request_id = envelope
            .context
            .as_ref()
            .map(|c| c.request_id.clone())
            .unwrap_or_default();
        let result = self.submit(principal_scope, envelope);
        let response = match result {
            Ok(response) => response,
            Err(error) => p::ResponseEnvelope {
                request_id: request_id.clone(),
                status: p::ResponseStatus::Rejected as i32,
                payload: Some(p::response_envelope::Payload::Error(p::Error {
                    code: match error {
                        ProtocolError::UnsupportedVersion => {
                            p::ErrorCode::UnsupportedVersion as i32
                        }
                        _ => p::ErrorCode::InvalidArgument as i32,
                    },
                    message: format!("{error:?}"),
                    request_id,
                    details: vec![],
                })),
                ..Default::default()
            },
        };
        Ok(response.encode_to_vec())
    }
    fn submit(
        &mut self,
        principal_scope: &str,
        envelope: p::CommandEnvelope,
    ) -> Result<p::ResponseEnvelope, ProtocolError> {
        let context = envelope.context.ok_or(ProtocolError::MissingField)?;
        let version = context
            .protocol_version
            .ok_or(ProtocolError::MissingField)?;
        if version.major != 1 || version.minor != 0 || version.schema_id != "spaceeyes.core.v1" {
            return Err(ProtocolError::UnsupportedVersion);
        }
        if context.session_id.len() > 256 {
            return Err(ProtocolError::InvalidContext);
        }
        let command = match envelope.payload.ok_or(ProtocolError::MissingField)? {
            p::command_envelope::Payload::Scene(command) => Command::Scene {
                expected_revision: Revision(
                    context
                        .expected_scene_revision
                        .ok_or(ProtocolError::MissingField)?,
                ),
                commands: scene_commands(vec![command])?,
            },
            p::command_envelope::Payload::SceneTransaction(transaction) => {
                let revision = transaction
                    .expected_revision
                    .ok_or(ProtocolError::MissingField)?;
                if context
                    .expected_scene_revision
                    .is_some_and(|r| r != revision)
                {
                    return Err(ProtocolError::InvalidContext);
                }
                Command::Scene {
                    expected_revision: Revision(revision),
                    commands: scene_commands(transaction.commands)?,
                }
            }
            p::command_envelope::Payload::Time(command) => {
                match command.action.ok_or(ProtocolError::MissingField)? {
                    p::time_command::Action::Play(_) => Command::Play,
                    p::time_command::Action::Pause(_) => Command::Pause,
                    p::time_command::Action::Seek(c) => Command::Seek(decode_instant(
                        c.instant.ok_or(ProtocolError::MissingField)?,
                    )?),
                    p::time_command::Action::Step(c) => Command::Step(i128::from(c.delta_nanos)),
                    p::time_command::Action::SetRate(c) => {
                        if !c.rate.is_finite() {
                            return Err(ProtocolError::InvalidTime);
                        }
                        let mut rate = None;
                        for denominator in [1u32, 10, 100, 1000, 10000, 100000, 1000000] {
                            let scaled = c.rate * f64::from(denominator);
                            if scaled.abs() <= f64::from(i32::MAX)
                                && scaled.round() / f64::from(denominator) == c.rate
                            {
                                if let Ok(value) = spaceeyes_time::PlaybackRate::new(
                                    scaled.round() as i32,
                                    denominator,
                                ) {
                                    rate = Some(value);
                                    break;
                                }
                            }
                        }
                        Command::SetRate(rate.ok_or(ProtocolError::InvalidTime)?)
                    }
                    _ => return Err(ProtocolError::UnsupportedCommand),
                }
            }
        };
        // The generation precondition is included in dispatcher history semantics below.
        let result = self.dispatcher.submit_with_generation(
            &context.session_id,
            principal_scope,
            &context.request_id,
            context.time_generation.map(spaceeyes_time::TimeGeneration),
            command,
        );
        let mut response = p::ResponseEnvelope {
            request_id: context.request_id.clone(),
            ..Default::default()
        };
        match result {
            Ok(receipt) => {
                response.status = p::ResponseStatus::Completed as i32;
                response.command_sequence = receipt.command_sequence;
                response.committed_scene_revision = receipt.scene_revision.0;
                response.frame_sequence = receipt.frame_sequence;
                response.payload = Some(p::response_envelope::Payload::Scene(p::SceneResponse {
                    revision: receipt.scene_revision.0,
                }));
            }
            Err(error) => {
                response.status = p::ResponseStatus::Rejected as i32;
                let code = match &error {
                    DispatchError::IdempotencyConflict => p::ErrorCode::IdempotencyConflict,
                    DispatchError::StaleGeneration => p::ErrorCode::StaleGeneration,
                    DispatchError::Domain(CoreError::RevisionConflict) => {
                        p::ErrorCode::RevisionConflict
                    }
                    DispatchError::Domain(CoreError::UnknownFrame) => p::ErrorCode::UnknownFrame,
                    DispatchError::Domain(CoreError::UnknownObject) => p::ErrorCode::UnknownObject,
                    DispatchError::HistoryFull => p::ErrorCode::ResourceExceeded,
                    _ => p::ErrorCode::InvalidArgument,
                };
                response.payload = Some(p::response_envelope::Payload::Error(p::Error {
                    code: code as i32,
                    message: format!("{error:?}"),
                    request_id: context.request_id,
                    details: vec![],
                }));
            }
        }
        Ok(response)
    }
}
fn checked_object(id: p::ObjectId) -> Result<spaceeyes_foundation::ObjectId, ProtocolError> {
    if id.value.len() > 256 {
        return Err(ProtocolError::InvalidIdentifier);
    }
    decode_object_id(id)
}
fn scene_commands(commands: Vec<p::SceneCommand>) -> Result<Vec<SceneCommand>, ProtocolError> {
    if commands.len() > 1024 {
        return Err(ProtocolError::MessageTooLarge);
    }
    let mut output = Vec::new();
    for command in commands {
        use p::scene_command::Action;
        match command.action.ok_or(ProtocolError::MissingField)? {
            Action::Create(c) => {
                let object = c.object.ok_or(ProtocolError::MissingField)?;
                if object.lifecycle != p::ObjectLifecycle::Active as i32 || object.unresolved {
                    return Err(ProtocolError::InvalidContext);
                }
                let id = checked_object(object.object_id.ok_or(ProtocolError::MissingField)?)?;
                output.push(SceneCommand::Create(SceneObject::new(id.clone())));
                if let Some(parent) = object.parent_id {
                    output.push(SceneCommand::SetParent {
                        object: id.clone(),
                        parent: Some(checked_object(parent)?),
                    });
                }
                if let Some(frame) = object.frame_id {
                    output.push(SceneCommand::SetFrame {
                        object: id.clone(),
                        frame: Some(decode_frame_id(frame)?),
                    });
                }
                output.push(SceneCommand::SetVisibility {
                    object: id.clone(),
                    visible: object.visible,
                });
                if object.resources.len() > 256 {
                    return Err(ProtocolError::MessageTooLarge);
                }
                if let Some(sphere) = object.sphere {
                    output.push(SceneCommand::SetSphere {
                        object: id.clone(),
                        sphere: Some(decode_sphere(sphere)?),
                    });
                }
                if let Some(camera) = object.camera {
                    output.push(SceneCommand::SetCamera {
                        object: id.clone(),
                        camera: Some(decode_camera(camera)?),
                    });
                }
                output.push(SceneCommand::SetResources {
                    object: id,
                    resources: object
                        .resources
                        .into_iter()
                        .map(decode_resource_id)
                        .collect::<Result<_, _>>()?,
                });
            }
            Action::SetCamera(c) => output.push(SceneCommand::SetCamera {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                camera: c.camera.map(decode_camera).transpose()?,
            }),
            Action::SetSphere(c) => output.push(SceneCommand::SetSphere {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                sphere: c.sphere.map(decode_sphere).transpose()?,
            }),
            Action::Remove(c) => output.push(SceneCommand::Delete {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
            }),
            Action::SetParent(c) => output.push(SceneCommand::SetParent {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                parent: c.parent_id.map(checked_object).transpose()?,
            }),
            Action::SetVisibility(c) => output.push(SceneCommand::SetVisibility {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                visible: c.visible,
            }),
            Action::SetFrame(c) => output.push(SceneCommand::SetFrame {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                frame: c.frame_id.map(decode_frame_id).transpose()?,
            }),
            Action::SetResources(c) => {
                if c.resources.len() > 256 {
                    return Err(ProtocolError::MessageTooLarge);
                }
                output.push(SceneCommand::SetResources {
                    object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                    resources: c
                        .resources
                        .into_iter()
                        .map(decode_resource_id)
                        .collect::<Result<_, _>>()?,
                });
            }
        }
    }
    Ok(output)
}

pub fn decode_camera(value: p::CameraState) -> Result<CameraState, ProtocolError> {
    let position = value.position_m.ok_or(ProtocolError::MissingField)?;
    let rotation = value.orientation.ok_or(ProtocolError::MissingField)?;
    let projection = value
        .projection
        .ok_or(ProtocolError::MissingField)?
        .kind
        .ok_or(ProtocolError::MissingField)?;
    let p::projection::Kind::Perspective(projection) = projection;
    CameraState::new(
        [position.x, position.y, position.z],
        [rotation.w, rotation.x, rotation.y, rotation.z],
        projection.vertical_fov_radians,
        projection.near_m,
        projection.far_m,
    )
    .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_camera(camera: &CameraState) -> p::CameraState {
    let [x, y, z] = camera.position_m();
    let [w, qx, qy, qz] = camera.orientation_wxyz();
    p::CameraState {
        position_m: Some(p::Vector3d { x, y, z }),
        orientation: Some(p::Quaterniond {
            w,
            x: qx,
            y: qy,
            z: qz,
        }),
        projection: Some(p::Projection {
            kind: Some(p::projection::Kind::Perspective(p::PerspectiveProjection {
                vertical_fov_radians: camera.vertical_fov_radians(),
                near_m: camera.near_m(),
                far_m: camera.far_m(),
            })),
        }),
    }
}

pub fn decode_sphere(sphere: p::SpherePrimitive) -> Result<Sphere, ProtocolError> {
    let color = sphere.base_color.ok_or(ProtocolError::MissingField)?;
    Sphere::new(sphere.radius_m, [color.r, color.g, color.b])
        .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_sphere(sphere: &Sphere) -> p::SpherePrimitive {
    let [r, g, b] = sphere.base_color();
    p::SpherePrimitive {
        radius_m: sphere.radius_m(),
        base_color: Some(p::ColorRgb { r, g, b }),
    }
}
