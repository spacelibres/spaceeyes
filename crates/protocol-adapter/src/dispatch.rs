// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use crate::{
    decode_frame_id, decode_instant, decode_object_id, decode_resource_id, encode_instant,
    generated as p, ProtocolError,
};
use prost::Message;
use spaceeyes_engine::{Command, CommandDispatcher, DispatchError};
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{CameraState, Material, MeshInstance, SceneCommand, SceneObject, Sphere};

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
        validate_wire_context(&context)?;
        let command = match envelope.payload.ok_or(ProtocolError::MissingField)? {
            p::command_envelope::Payload::Lifecycle(command) => {
                match command.action.ok_or(ProtocolError::MissingField)? {
                    p::lifecycle_command::Action::Start(_) => Command::Start,
                    p::lifecycle_command::Action::Stop(_) => Command::Stop,
                }
            }
            p::command_envelope::Payload::Spatial(command) => {
                let expected_revision = Revision(
                    command
                        .expected_revision
                        .ok_or(ProtocolError::MissingField)?,
                );
                match command.action.ok_or(ProtocolError::MissingField)? {
                    p::spatial_command::Action::RegisterRoot(c) => Command::RegisterRootFrame {
                        id: decode_frame_id(c.frame_id.ok_or(ProtocolError::MissingField)?)?,
                        expected_revision,
                    },
                    p::spatial_command::Action::RegisterChildSample(c) => {
                        Command::RegisterChildFrame {
                            id: decode_frame_id(c.frame_id.ok_or(ProtocolError::MissingField)?)?,
                            parent: decode_frame_id(
                                c.parent_id.ok_or(ProtocolError::MissingField)?,
                            )?,
                            expected_revision,
                            sample: spaceeyes_spatial::FrameSample {
                                instant: decode_instant(
                                    c.instant.ok_or(ProtocolError::MissingField)?,
                                )?,
                                to_parent: crate::query::decode_transform(
                                    c.to_parent.ok_or(ProtocolError::MissingField)?,
                                )?,
                            },
                        }
                    }
                }
            }
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
            p::command_envelope::Payload::Resource(command) => {
                match command.action.ok_or(ProtocolError::MissingField)? {
                    p::resource_command::Action::RegisterMesh(command) => Command::RegisterMesh {
                        id: decode_resource_id(
                            command.resource_id.ok_or(ProtocolError::MissingField)?,
                        )?,
                        mesh: decode_mesh_geometry(
                            command.mesh.ok_or(ProtocolError::MissingField)?,
                        )?,
                    },
                    p::resource_command::Action::RegisterTexture(command) => {
                        Command::RegisterTexture {
                            id: decode_resource_id(
                                command.resource_id.ok_or(ProtocolError::MissingField)?,
                            )?,
                            texture: decode_texture(
                                command.texture.ok_or(ProtocolError::MissingField)?,
                            )?,
                        }
                    }
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
        let resource_id = match &command {
            Command::RegisterMesh { id, .. } | Command::RegisterTexture { id, .. } => {
                Some(p::ResourceId {
                    value: id.as_str().to_owned(),
                })
            }
            _ => None,
        };
        let spatial = matches!(
            &command,
            Command::RegisterRootFrame { .. } | Command::RegisterChildFrame { .. }
        );
        let lifecycle = matches!(&command, Command::Start | Command::Stop);
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
                response.payload = Some(if spatial {
                    p::response_envelope::Payload::Spatial(p::SpatialResponse {
                        frame_graph_revision: receipt.frame_graph_revision.0,
                    })
                } else if lifecycle {
                    p::response_envelope::Payload::Session(crate::query::encode_status(
                        &receipt.session_status,
                    )?)
                } else if let Some(resource_id) = resource_id {
                    p::response_envelope::Payload::Resource(p::ResourceResponse {
                        resource_id: Some(resource_id),
                        resource_revision: receipt.resource_revision,
                    })
                } else {
                    p::response_envelope::Payload::Scene(p::SceneResponse {
                        revision: receipt.scene_revision.0,
                    })
                });
            }
            Err(error) => {
                response.status = p::ResponseStatus::Rejected as i32;
                let code = dispatch_error_code(&error);
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
                if let Some(mesh) = object.mesh {
                    output.push(SceneCommand::SetMesh {
                        object: id.clone(),
                        mesh: Some(decode_mesh_instance(mesh)?),
                    });
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
            Action::SetMesh(c) => output.push(SceneCommand::SetMesh {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                mesh: c.mesh.map(decode_mesh_instance).transpose()?,
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
    Sphere::with_material(
        sphere.radius_m,
        decode_appearance(sphere.base_color, sphere.material)?,
    )
    .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_sphere(sphere: &Sphere) -> p::SpherePrimitive {
    let [r, g, b] = sphere.base_color();
    p::SpherePrimitive {
        radius_m: sphere.radius_m(),
        material: Some(encode_material(sphere.material())),
        base_color: Some(p::ColorRgb { r, g, b }),
    }
}

pub fn decode_mesh_geometry(
    mesh: p::TriangleMesh,
) -> Result<spaceeyes_geometry::TriangleMesh, ProtocolError> {
    use spaceeyes_geometry::{TriangleMesh, Vertex, MAX_INDICES, MAX_VERTICES};
    if mesh.vertices.len() > MAX_VERTICES || mesh.indices.len() > MAX_INDICES {
        return Err(ProtocolError::MessageTooLarge);
    }
    let vertices = mesh
        .vertices
        .into_iter()
        .map(|v| {
            let p = v.position_m.ok_or(ProtocolError::MissingField)?;
            let n = v.normal.ok_or(ProtocolError::MissingField)?;
            let uv = v.uv.map(|uv| [uv.x, uv.y]).unwrap_or([0.0; 2]);
            Vertex::with_uv([p.x, p.y, p.z], [n.x, n.y, n.z], uv)
                .map_err(|_| ProtocolError::InvalidContext)
        })
        .collect::<Result<Vec<_>, _>>()?;
    TriangleMesh::new(vertices, mesh.indices).map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_mesh_geometry(mesh: &spaceeyes_geometry::TriangleMesh) -> p::TriangleMesh {
    p::TriangleMesh {
        vertices: mesh
            .vertices()
            .iter()
            .map(|v| {
                let [x, y, z] = v.position_m();
                let [nx, ny, nz] = v.normal();
                p::MeshVertex {
                    uv: Some(p::Vector2f {
                        x: v.uv()[0],
                        y: v.uv()[1],
                    }),
                    position_m: Some(p::Vector3d { x, y, z }),
                    normal: Some(p::Vector3d {
                        x: nx,
                        y: ny,
                        z: nz,
                    }),
                }
            })
            .collect(),
        indices: mesh.indices().to_vec(),
    }
}
pub fn decode_mesh_instance(mesh: p::MeshInstance) -> Result<MeshInstance, ProtocolError> {
    Ok(MeshInstance::with_material(
        decode_resource_id(mesh.geometry.ok_or(ProtocolError::MissingField)?)?,
        decode_appearance(mesh.base_color, mesh.material)?,
    ))
}
pub fn encode_mesh_instance(mesh: &MeshInstance) -> p::MeshInstance {
    let [r, g, b] = mesh.base_color();
    p::MeshInstance {
        material: Some(encode_material(mesh.material())),
        geometry: Some(p::ResourceId {
            value: mesh.geometry().as_str().to_owned(),
        }),
        base_color: Some(p::ColorRgb { r, g, b }),
    }
}

pub fn decode_texture(
    texture: p::TextureData,
) -> Result<spaceeyes_geometry::TextureData, ProtocolError> {
    use spaceeyes_geometry::{ColorSpace, TextureData};
    let color = match p::TextureColorSpace::try_from(texture.color_space) {
        Ok(p::TextureColorSpace::Linear) => ColorSpace::Linear,
        Ok(p::TextureColorSpace::Srgb) => ColorSpace::Srgb,
        _ => return Err(ProtocolError::InvalidContext),
    };
    TextureData::new(texture.width, texture.height, texture.rgba8, color)
        .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_texture(texture: &spaceeyes_geometry::TextureData) -> p::TextureData {
    p::TextureData {
        width: texture.width(),
        height: texture.height(),
        rgba8: texture.rgba8().to_vec(),
        color_space: match texture.color_space() {
            spaceeyes_geometry::ColorSpace::Linear => p::TextureColorSpace::Linear as i32,
            spaceeyes_geometry::ColorSpace::Srgb => p::TextureColorSpace::Srgb as i32,
        },
    }
}
fn decode_appearance(
    color: Option<p::ColorRgb>,
    material: Option<p::Material>,
) -> Result<Material, ProtocolError> {
    if let Some(material) = material {
        let material = decode_material(material)?;
        if color.is_some_and(|c| [c.r, c.g, c.b] != material.base_color()) {
            return Err(ProtocolError::InvalidContext);
        }
        Ok(material)
    } else {
        let color = color.ok_or(ProtocolError::MissingField)?;
        Material::new([color.r, color.g, color.b], None, Default::default(), false)
            .map_err(|_| ProtocolError::InvalidContext)
    }
}
pub fn decode_material(material: p::Material) -> Result<Material, ProtocolError> {
    use spaceeyes_geometry::{Sampling, TextureAddress, TextureFilter};
    let filter = match p::SamplingFilter::try_from(material.filter) {
        Ok(p::SamplingFilter::Nearest) => TextureFilter::Nearest,
        Ok(p::SamplingFilter::Linear) => TextureFilter::Linear,
        _ => return Err(ProtocolError::InvalidContext),
    };
    let address = match p::SamplingAddress::try_from(material.address) {
        Ok(p::SamplingAddress::Clamp) => TextureAddress::Clamp,
        Ok(p::SamplingAddress::Repeat) => TextureAddress::Repeat,
        _ => return Err(ProtocolError::InvalidContext),
    };
    let color = material.base_color.ok_or(ProtocolError::MissingField)?;
    Material::new(
        [color.r, color.g, color.b],
        material.texture.map(decode_resource_id).transpose()?,
        Sampling { filter, address },
        material.unlit,
    )
    .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_material(material: &Material) -> p::Material {
    use spaceeyes_geometry::{TextureAddress, TextureFilter};
    let [r, g, b] = material.base_color();
    p::Material {
        base_color: Some(p::ColorRgb { r, g, b }),
        texture: material.texture().map(|id| p::ResourceId {
            value: id.as_str().to_owned(),
        }),
        filter: match material.sampling().filter {
            TextureFilter::Nearest => p::SamplingFilter::Nearest as i32,
            TextureFilter::Linear => p::SamplingFilter::Linear as i32,
        },
        address: match material.sampling().address {
            TextureAddress::Clamp => p::SamplingAddress::Clamp as i32,
            TextureAddress::Repeat => p::SamplingAddress::Repeat as i32,
        },
        unlit: material.unlit(),
    }
}

pub(crate) fn validate_wire_context(context: &p::RequestContext) -> Result<(), ProtocolError> {
    let version = context
        .protocol_version
        .as_ref()
        .ok_or(ProtocolError::MissingField)?;
    if version.major != 1 || version.minor != 0 || version.schema_id != "spaceeyes.core.v1" {
        return Err(ProtocolError::UnsupportedVersion);
    }
    if context.session_id.len() > 256 {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(())
}
pub(crate) fn dispatch_error_code(error: &DispatchError) -> p::ErrorCode {
    match error {
        DispatchError::IdempotencyConflict => p::ErrorCode::IdempotencyConflict,
        DispatchError::StaleGeneration => p::ErrorCode::StaleGeneration,
        DispatchError::Domain(CoreError::RevisionConflict) => p::ErrorCode::RevisionConflict,
        DispatchError::Domain(CoreError::UnknownFrame) => p::ErrorCode::UnknownFrame,
        DispatchError::Domain(CoreError::UnknownObject) => p::ErrorCode::UnknownObject,
        DispatchError::Resource(spaceeyes_resources::ResourceError::BudgetExceeded) => {
            p::ErrorCode::ResourceExceeded
        }
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::UnknownFrame) => {
            p::ErrorCode::UnknownFrame
        }
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::TimeNotCovered) => {
            p::ErrorCode::TimeNotCovered
        }
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::EngineUnavailable)
        | DispatchError::Domain(CoreError::AlreadyStopped) => p::ErrorCode::EngineUnavailable,
        DispatchError::HistoryFull => p::ErrorCode::ResourceExceeded,
        _ => p::ErrorCode::InvalidArgument,
    }
}
