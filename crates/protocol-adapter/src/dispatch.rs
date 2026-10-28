// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use crate::limits;
use crate::{
    decode_frame_id, decode_instant, decode_object_id, decode_resource_id, encode_instant,
    generated as p, ProtocolError,
};
use prost::Message;
use spaceeyes_engine::{Command, CommandDispatcher, DispatchError};
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{
    CameraState, LinePrimitive, Material, MeshInstance, SceneCommand, SceneObject, Sphere,
    MAX_LINE_POINTS,
};

pub struct ProtocolAdapter {
    pub(crate) dispatcher: CommandDispatcher,
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
        if bytes.len() > limits::MAX_MESSAGE_BYTES {
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
            p::command_envelope::Payload::Camera(command) => {
                let p::camera_command::Action::Focus(c) =
                    command.action.ok_or(ProtocolError::MissingField)?;
                if context.time_generation.is_none()
                    || !c.distance_m.is_finite()
                    || c.distance_m <= 0.0
                {
                    return Err(ProtocolError::InvalidContext);
                }
                Command::FocusCamera {
                    expected_revision: Revision(
                        context
                            .expected_scene_revision
                            .ok_or(ProtocolError::MissingField)?,
                    ),
                    camera: checked_object(c.camera.ok_or(ProtocolError::MissingField)?)?,
                    target: checked_object(c.target.ok_or(ProtocolError::MissingField)?)?,
                    distance_m: c.distance_m,
                    follow: c.follow,
                }
            }
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
                    p::spatial_command::Action::RegisterProviderFrame(c) => {
                        let provider = c.provider.ok_or(ProtocolError::MissingField)?;
                        validate_provider_identity(
                            &provider.provider_id,
                            &provider.provider_version,
                        )?;
                        Command::RegisterProviderFrame {
                            id: decode_frame_id(c.frame_id.ok_or(ProtocolError::MissingField)?)?,
                            parent: decode_frame_id(
                                c.parent_id.ok_or(ProtocolError::MissingField)?,
                            )?,
                            provider_id: provider.provider_id,
                            provider_version: provider.provider_version,
                            expected_revision,
                        }
                    }
                    p::spatial_command::Action::UpdateProviderFrameSample(c) => {
                        Command::UpdateProviderFrameSample {
                            id: decode_frame_id(c.frame_id.ok_or(ProtocolError::MissingField)?)?,
                            sample: spaceeyes_spatial::FrameSample {
                                instant: decode_instant(
                                    c.instant.ok_or(ProtocolError::MissingField)?,
                                )?,
                                to_parent: crate::query::decode_transform(
                                    c.to_parent.ok_or(ProtocolError::MissingField)?,
                                )?,
                            },
                            expected_revision,
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
                    p::resource_command::Action::BeginUpload(c) => Command::BeginUpload {
                        descriptor: crate::uploads::decode_descriptor(c)?,
                    },
                    p::resource_command::Action::AppendUpload(c) => {
                        crate::uploads::validate_upload_id(&c.upload_id)?;
                        if c.data.is_empty()
                            || c.data.len() > spaceeyes_resources::MAX_UPLOAD_CHUNK_BYTES
                        {
                            return Err(ProtocolError::InvalidContext);
                        }
                        Command::AppendUpload {
                            upload_id: c.upload_id,
                            offset: c.offset,
                            data: c.data,
                        }
                    }
                    p::resource_command::Action::FinishUpload(c) => {
                        crate::uploads::validate_upload_id(&c.upload_id)?;
                        Command::FinishUpload {
                            upload_id: c.upload_id,
                        }
                    }
                    p::resource_command::Action::CancelUpload(c) => {
                        crate::uploads::validate_upload_id(&c.upload_id)?;
                        Command::CancelUpload {
                            upload_id: c.upload_id,
                        }
                    }
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
            Command::RegisterRootFrame { .. }
                | Command::RegisterChildFrame { .. }
                | Command::RegisterProviderFrame { .. }
                | Command::UpdateProviderFrameSample { .. }
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
                response.payload = Some(if let Some(upload) = &receipt.upload {
                    p::response_envelope::Payload::Upload(crate::uploads::encode_status(upload))
                } else if let Some(id) = &receipt.upload_resource {
                    p::response_envelope::Payload::Resource(p::ResourceResponse {
                        resource_id: Some(p::ResourceId {
                            value: id.as_str().into(),
                        }),
                        resource_revision: receipt.resource_revision,
                    })
                } else if spatial {
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
    if id.value.len() > limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidIdentifier);
    }
    decode_object_id(id)
}
fn scene_commands(commands: Vec<p::SceneCommand>) -> Result<Vec<SceneCommand>, ProtocolError> {
    if commands.len() > limits::MAX_SCENE_COMMANDS {
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
                if object.resources.len() > limits::MAX_OBJECT_RESOURCES {
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
                if let Some(line) = object.line {
                    output.push(SceneCommand::SetLine {
                        object: id.clone(),
                        line: Some(decode_line(line)?),
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
            Action::SetLine(c) => output.push(SceneCommand::SetLine {
                object: checked_object(c.object_id.ok_or(ProtocolError::MissingField)?)?,
                line: c.line.map(decode_line).transpose()?,
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
                if c.resources.len() > limits::MAX_OBJECT_RESOURCES {
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
    let tracking = value
        .tracking
        .map(|t| {
            spaceeyes_scene::CameraTracking::new(
                checked_object(t.target.ok_or(ProtocolError::MissingField)?)?,
                t.distance_m,
            )
            .map_err(|_| ProtocolError::InvalidContext)
        })
        .transpose()?;
    let position = value.position_m.ok_or(ProtocolError::MissingField)?;
    let rotation = value.orientation.ok_or(ProtocolError::MissingField)?;
    let projection = value
        .projection
        .ok_or(ProtocolError::MissingField)?
        .kind
        .ok_or(ProtocolError::MissingField)?;
    let position = [position.x, position.y, position.z];
    let rotation = [rotation.w, rotation.x, rotation.y, rotation.z];
    match projection {
        p::projection::Kind::Perspective(projection) => CameraState::new(
            position,
            rotation,
            projection.vertical_fov_radians,
            projection.near_m,
            projection.far_m,
        ),
        p::projection::Kind::Orthographic(projection) => CameraState::new_orthographic(
            position,
            rotation,
            projection.half_height_m,
            projection.near_m,
            projection.far_m,
        ),
    }
    .and_then(|camera| camera.with_tracking(tracking))
    .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_camera(camera: &CameraState) -> p::CameraState {
    let [x, y, z] = camera.position_m();
    let [w, qx, qy, qz] = camera.orientation_wxyz();
    p::CameraState {
        tracking: camera.tracking().map(|t| p::CameraTracking {
            target: Some(p::ObjectId {
                value: t.target().as_str().into(),
            }),
            distance_m: t.distance_m(),
        }),
        position_m: Some(p::Vector3d { x, y, z }),
        orientation: Some(p::Quaterniond {
            w,
            x: qx,
            y: qy,
            z: qz,
        }),
        projection: Some(p::Projection {
            kind: Some(match camera.projection() {
                spaceeyes_scene::CameraProjection::Perspective {
                    vertical_fov_radians,
                } => p::projection::Kind::Perspective(p::PerspectiveProjection {
                    vertical_fov_radians,
                    near_m: camera.near_m(),
                    far_m: camera.far_m(),
                }),
                spaceeyes_scene::CameraProjection::Orthographic { half_height_m } => {
                    p::projection::Kind::Orthographic(p::OrthographicProjection {
                        half_height_m,
                        near_m: camera.near_m(),
                        far_m: camera.far_m(),
                    })
                }
            }),
        }),
    }
}

pub fn decode_line(line: p::LinePrimitive) -> Result<LinePrimitive, ProtocolError> {
    if line.points_m.len() > MAX_LINE_POINTS {
        return Err(ProtocolError::MessageTooLarge);
    }
    let points: Vec<[f64; 3]> = line
        .points_m
        .into_iter()
        .map(|point| [point.x, point.y, point.z])
        .collect();
    let color = line.color.ok_or(ProtocolError::MissingField)?;
    LinePrimitive::new(points, [color.r, color.g, color.b])
        .map_err(|_| ProtocolError::InvalidContext)
}
pub fn encode_line(line: &LinePrimitive) -> p::LinePrimitive {
    let [r, g, b] = line.color();
    p::LinePrimitive {
        points_m: line
            .points_m()
            .iter()
            .map(|[x, y, z]| p::Vector3d {
                x: *x,
                y: *y,
                z: *z,
            })
            .collect(),
        color: Some(p::ColorRgb { r, g, b }),
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
    let alpha = material.alpha.unwrap_or(1.0);
    Material::new(
        [color.r, color.g, color.b],
        material.texture.map(decode_resource_id).transpose()?,
        Sampling { filter, address },
        material.unlit,
    )
    .and_then(|material| material.with_alpha(alpha))
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
        alpha: (material.alpha() != 1.0).then_some(material.alpha()),
    }
}

pub(crate) fn validate_wire_context(context: &p::RequestContext) -> Result<(), ProtocolError> {
    let version = context
        .protocol_version
        .as_ref()
        .ok_or(ProtocolError::MissingField)?;
    if version.major != limits::PROTOCOL_MAJOR
        || version.minor != limits::PROTOCOL_MINOR
        || version.schema_id != limits::SCHEMA_ID
    {
        return Err(ProtocolError::UnsupportedVersion);
    }
    if context.session_id.len() > limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(())
}
fn validate_provider_identity(provider_id: &str, version: &str) -> Result<(), ProtocolError> {
    if provider_id.trim().is_empty()
        || provider_id.len() > 256
        || version.trim().is_empty()
        || version.len() > 128
    {
        return Err(ProtocolError::InvalidIdentifier);
    }
    Ok(())
}

pub(crate) fn dispatch_error_code(error: &DispatchError) -> p::ErrorCode {
    match error {
        DispatchError::Resource(spaceeyes_resources::ResourceError::PermissionDenied) => {
            p::ErrorCode::PermissionDenied
        }
        DispatchError::Resource(spaceeyes_resources::ResourceError::EngineUnavailable) => {
            p::ErrorCode::EngineUnavailable
        }
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
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::MissingTransform) => {
            p::ErrorCode::ProviderUnavailable
        }
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::InvalidProvider) => {
            p::ErrorCode::InvalidArgument
        }
        DispatchError::Spatial(spaceeyes_spatial::SpatialError::EngineUnavailable)
        | DispatchError::Domain(CoreError::AlreadyStopped) => p::ErrorCode::EngineUnavailable,
        DispatchError::HistoryFull => p::ErrorCode::ResourceExceeded,
        _ => p::ErrorCode::InvalidArgument,
    }
}

#[cfg(test)]
mod line_tests {
    use super::*;

    fn point(x: f64, y: f64, z: f64) -> p::Vector3d {
        p::Vector3d { x, y, z }
    }

    #[test]
    fn line_primitives_roundtrip_and_reject_invalid_shapes() {
        let line =
            LinePrimitive::new(vec![[0.0, 0.0, 0.0], [1.0, 2.0, 3.0]], [0.1, 0.2, 0.3]).unwrap();
        assert_eq!(decode_line(encode_line(&line)).unwrap(), line);

        let single = p::LinePrimitive {
            points_m: vec![point(0.0, 0.0, 0.0)],
            color: Some(p::ColorRgb {
                r: 1.0,
                g: 1.0,
                b: 1.0,
            }),
        };
        assert_eq!(decode_line(single), Err(ProtocolError::InvalidContext));

        let missing_color = p::LinePrimitive {
            points_m: vec![point(0.0, 0.0, 0.0), point(1.0, 0.0, 0.0)],
            color: None,
        };
        assert_eq!(decode_line(missing_color), Err(ProtocolError::MissingField));

        let too_many = p::LinePrimitive {
            points_m: vec![point(0.0, 0.0, 0.0); MAX_LINE_POINTS + 1],
            color: Some(p::ColorRgb {
                r: 1.0,
                g: 1.0,
                b: 1.0,
            }),
        };
        assert_eq!(decode_line(too_many), Err(ProtocolError::MessageTooLarge));
    }
}
