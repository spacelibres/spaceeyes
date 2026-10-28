// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Structured project snapshot mapping. Persistence never stores GPU handles,
//! tasks, upload sessions or internal object handles.
use crate::generated as p;
use crate::{
    decode_frame_id, decode_instant, decode_object_id, decode_resource_id, encode_instant,
    ProtocolError,
};
use spaceeyes_engine::ProjectState;
use spaceeyes_resources::{ResourceClass, ResourceRecord, UploadSource};
use spaceeyes_scene::{Scene, SceneCommand, SceneObject, SceneSnapshot};
use spaceeyes_spatial::{FrameRecord, FrameSample};
use spaceeyes_time::{ClockMode, ClockSnapshot, PlaybackRate, TimeGeneration};

pub fn encode_project(state: &ProjectState) -> Result<p::ProjectSnapshot, ProtocolError> {
    Ok(p::ProjectSnapshot {
        schema_version: state.schema_version,
        clock: Some(encode_clock(&state.clock)?),
        scene_revision: state.scene.revision.0,
        objects: state
            .scene
            .objects
            .iter()
            .map(encode_scene_object)
            .collect::<Result<_, _>>()?,
        frames: state
            .frames
            .iter()
            .map(encode_frame)
            .collect::<Result<_, _>>()?,
        resources: state
            .resources
            .iter()
            .map(encode_resource)
            .collect::<Result<_, _>>()?,
    })
}

pub fn decode_project(snapshot: &p::ProjectSnapshot) -> Result<ProjectState, ProtocolError> {
    if snapshot.schema_version != 1 {
        return Err(ProtocolError::UnsupportedVersion);
    }
    let clock = snapshot.clock.as_ref().ok_or(ProtocolError::MissingField)?;
    let clock = ClockSnapshot {
        rate: PlaybackRate::new(clock.rate_numerator, clock.rate_denominator)
            .map_err(|_| ProtocolError::InvalidContext)?,
        instant: decode_instant(clock.instant.clone().ok_or(ProtocolError::MissingField)?)?,
        generation: TimeGeneration(clock.generation),
        revision: clock.revision,
        mode: match p::PlaybackMode::try_from(clock.mode) {
            Ok(p::PlaybackMode::Paused) => ClockMode::Paused,
            Ok(p::PlaybackMode::Playing) => ClockMode::Playing,
            _ => return Err(ProtocolError::InvalidContext),
        },
    };
    let scene = decode_scene(&snapshot.objects)?;
    let frames = snapshot
        .frames
        .iter()
        .map(decode_frame)
        .collect::<Result<Vec<_>, _>>()?;
    let resources = snapshot
        .resources
        .iter()
        .map(decode_resource)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ProjectState {
        schema_version: snapshot.schema_version,
        scene,
        clock,
        frames,
        resources,
    })
}

fn encode_clock(clock: &ClockSnapshot) -> Result<p::ProjectClock, ProtocolError> {
    Ok(p::ProjectClock {
        instant: Some(encode_instant(&clock.instant)?),
        mode: match clock.mode {
            ClockMode::Paused => p::PlaybackMode::Paused as i32,
            ClockMode::Playing => p::PlaybackMode::Playing as i32,
        },
        rate_numerator: clock.rate.numerator(),
        rate_denominator: clock.rate.denominator(),
        generation: clock.generation.0,
        revision: clock.revision,
    })
}

pub(crate) fn encode_scene_object(object: &SceneObject) -> Result<p::SceneObject, ProtocolError> {
    Ok(p::SceneObject {
        object_id: Some(p::ObjectId {
            value: object.id().as_str().into(),
        }),
        parent_id: object.parent().map(|id| p::ObjectId {
            value: id.as_str().into(),
        }),
        frame_id: object.frame().map(|id| p::FrameId {
            value: id.as_str().into(),
        }),
        visible: object.visible(),
        lifecycle: p::ObjectLifecycle::Active as i32,
        resources: object
            .resource_refs()
            .into_iter()
            .map(|id| p::ResourceId {
                value: id.as_str().into(),
            })
            .collect(),
        unresolved: false,
        camera: object.camera().map(crate::dispatch::encode_camera),
        sphere: object.sphere().map(crate::dispatch::encode_sphere),
        mesh: object.mesh().map(crate::dispatch::encode_mesh_instance),
        line: object.line().map(crate::dispatch::encode_line),
    })
}

fn decode_scene(objects: &[p::SceneObject]) -> Result<SceneSnapshot, ProtocolError> {
    let mut scene = Scene::new();
    let mut pending: Vec<p::SceneObject> = objects.to_vec();
    while !pending.is_empty() {
        let before = pending.len();
        let mut next = Vec::new();
        for object in pending {
            let id = decode_object_id(
                object
                    .object_id
                    .clone()
                    .ok_or(ProtocolError::MissingField)?,
            )?;
            let parent = object.parent_id.clone().map(decode_object_id).transpose()?;
            if let Some(parent) = &parent {
                if scene.get(parent).is_none() {
                    next.push(object);
                    continue;
                }
            }
            let mut commands = vec![SceneCommand::Create(SceneObject::new(id.clone()))];
            if let Some(parent) = parent {
                commands.push(SceneCommand::SetParent {
                    object: id.clone(),
                    parent: Some(parent),
                });
            }
            if let Some(frame) = object.frame_id.clone() {
                commands.push(SceneCommand::SetFrame {
                    object: id.clone(),
                    frame: Some(decode_frame_id(frame)?),
                });
            }
            commands.push(SceneCommand::SetVisibility {
                object: id.clone(),
                visible: object.visible,
            });
            if let Some(mesh) = object.mesh {
                commands.push(SceneCommand::SetMesh {
                    object: id.clone(),
                    mesh: Some(crate::dispatch::decode_mesh_instance(mesh)?),
                });
            }
            if let Some(sphere) = object.sphere {
                commands.push(SceneCommand::SetSphere {
                    object: id.clone(),
                    sphere: Some(crate::dispatch::decode_sphere(sphere)?),
                });
            }
            if let Some(camera) = object.camera {
                commands.push(SceneCommand::SetCamera {
                    object: id.clone(),
                    camera: Some(crate::dispatch::decode_camera(camera)?),
                });
            }
            if let Some(line) = object.line {
                commands.push(SceneCommand::SetLine {
                    object: id.clone(),
                    line: Some(crate::dispatch::decode_line(line)?),
                });
            }
            commands.push(SceneCommand::SetResources {
                object: id,
                resources: object
                    .resources
                    .into_iter()
                    .map(decode_resource_id)
                    .collect::<Result<_, _>>()?,
            });
            scene
                .apply_transaction(scene.revision(), &commands)
                .map_err(|_| ProtocolError::InvalidContext)?;
        }
        if next.len() == before {
            return Err(ProtocolError::InvalidContext);
        }
        pending = next;
    }
    Ok(scene.snapshot())
}

fn encode_frame(record: &FrameRecord) -> Result<p::ProjectFrameRecord, ProtocolError> {
    Ok(p::ProjectFrameRecord {
        frame_id: Some(p::FrameId {
            value: record.id.as_str().into(),
        }),
        parent_id: record.parent.as_ref().map(|id| p::FrameId {
            value: id.as_str().into(),
        }),
        sample: record
            .sample
            .as_ref()
            .map(|sample| {
                Ok::<_, ProtocolError>(p::ProjectFrameSample {
                    instant: Some(encode_instant(&sample.instant)?),
                    to_parent: Some(crate::query::encode_transform(sample.to_parent)),
                })
            })
            .transpose()?,
        provider: record
            .provider
            .as_ref()
            .map(|(provider_id, version)| p::ProviderIdentity {
                provider_id: provider_id.clone(),
                provider_version: version.clone(),
            }),
    })
}

fn decode_frame(record: &p::ProjectFrameRecord) -> Result<FrameRecord, ProtocolError> {
    let id = decode_frame_id(record.frame_id.clone().ok_or(ProtocolError::MissingField)?)?;
    let parent = record.parent_id.clone().map(decode_frame_id).transpose()?;
    let sample = record
        .sample
        .as_ref()
        .map(|sample| {
            Ok::<_, ProtocolError>(FrameSample {
                instant: decode_instant(
                    sample.instant.clone().ok_or(ProtocolError::MissingField)?,
                )?,
                to_parent: crate::query::decode_transform(
                    sample.to_parent.ok_or(ProtocolError::MissingField)?,
                )?,
            })
        })
        .transpose()?;
    let provider = record
        .provider
        .as_ref()
        .map(|provider| {
            if provider.provider_id.trim().is_empty()
                || provider.provider_id.len() > 256
                || provider.provider_version.trim().is_empty()
                || provider.provider_version.len() > 128
            {
                return Err(ProtocolError::InvalidIdentifier);
            }
            Ok((
                provider.provider_id.clone(),
                provider.provider_version.clone(),
            ))
        })
        .transpose()?;
    Ok(FrameRecord {
        id,
        parent,
        sample,
        provider,
    })
}

fn encode_resource(record: &ResourceRecord) -> Result<p::ProjectResourceRecord, ProtocolError> {
    Ok(p::ProjectResourceRecord {
        resource_id: Some(p::ResourceId {
            value: record.id.as_str().into(),
        }),
        bytes: record.bytes,
        class: match record.class {
            ResourceClass::Cpu => p::ResourceClass::Cpu as i32,
            ResourceClass::Gpu => p::ResourceClass::Gpu as i32,
            ResourceClass::Staging => p::ResourceClass::Staging as i32,
        },
        source: record.source.as_ref().map(|source| p::ResourceSource {
            source_id: source.source_id.clone(),
            source_version: source.source_version.clone(),
            sha256: source.sha256.to_vec(),
        }),
        data: record.data.clone().unwrap_or_default(),
        mesh: record
            .mesh
            .as_ref()
            .map(crate::dispatch::encode_mesh_geometry),
        texture: record.texture.as_ref().map(crate::dispatch::encode_texture),
        logical_only: record.logical_only,
    })
}

fn decode_resource(record: &p::ProjectResourceRecord) -> Result<ResourceRecord, ProtocolError> {
    let id = decode_resource_id(
        record
            .resource_id
            .clone()
            .ok_or(ProtocolError::MissingField)?,
    )?;
    let class = match p::ResourceClass::try_from(record.class) {
        Ok(p::ResourceClass::Cpu) => ResourceClass::Cpu,
        Ok(p::ResourceClass::Gpu) => ResourceClass::Gpu,
        Ok(p::ResourceClass::Staging) => ResourceClass::Staging,
        _ => return Err(ProtocolError::InvalidContext),
    };
    let source = record
        .source
        .as_ref()
        .map(|source| {
            let sha256: [u8; 32] = source
                .sha256
                .as_slice()
                .try_into()
                .map_err(|_| ProtocolError::InvalidContext)?;
            if source.source_id.trim().is_empty()
                || source.source_id.len() > 256
                || source.source_version.trim().is_empty()
                || source.source_version.len() > 128
            {
                return Err(ProtocolError::InvalidIdentifier);
            }
            Ok(UploadSource {
                source_id: source.source_id.clone(),
                source_version: source.source_version.clone(),
                sha256,
            })
        })
        .transpose()?;
    let mesh = record
        .mesh
        .clone()
        .map(crate::dispatch::decode_mesh_geometry)
        .transpose()?;
    let texture = record
        .texture
        .clone()
        .map(crate::dispatch::decode_texture)
        .transpose()?;
    if !record.data.is_empty() && record.bytes != record.data.len() as u64 {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(ResourceRecord {
        source,
        class,
        id,
        bytes: record.bytes,
        data: if record.data.is_empty() {
            None
        } else {
            Some(record.data.clone())
        },
        mesh,
        texture,
        logical_only: record.logical_only,
    })
}

pub fn decode_project_bytes(bytes: &[u8]) -> Result<ProjectState, ProtocolError> {
    use prost::Message;
    let snapshot = p::ProjectSnapshot::decode(bytes).map_err(|_| ProtocolError::InvalidContext)?;
    decode_project(&snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock() -> p::ProjectClock {
        p::ProjectClock {
            instant: Some(p::TimeInstant {
                time_scale: p::TimeScale::Tt as i32,
                epoch_id: "epoch".into(),
                seconds: 0,
                nanos: 0,
            }),
            mode: p::PlaybackMode::Paused as i32,
            rate_numerator: 1,
            rate_denominator: 1,
            generation: 0,
            revision: 0,
        }
    }

    fn object(id: &str, parent: Option<&str>) -> p::SceneObject {
        p::SceneObject {
            object_id: Some(p::ObjectId { value: id.into() }),
            parent_id: parent.map(|value| p::ObjectId {
                value: value.into(),
            }),
            frame_id: None,
            visible: true,
            lifecycle: p::ObjectLifecycle::Active as i32,
            resources: vec![],
            unresolved: false,
            camera: None,
            sphere: None,
            mesh: None,
            line: None,
        }
    }

    #[test]
    fn decoding_reorders_children_after_parents() {
        let snapshot = p::ProjectSnapshot {
            schema_version: 1,
            clock: Some(clock()),
            scene_revision: 0,
            objects: vec![object("child", Some("root")), object("root", None)],
            frames: vec![],
            resources: vec![],
        };
        let project = decode_project(&snapshot).unwrap();
        assert_eq!(project.scene.objects.len(), 2);
        let child = project
            .scene
            .objects
            .iter()
            .find(|object| object.id().as_str() == "child")
            .expect("child restored");
        assert_eq!(child.parent().map(|parent| parent.as_str()), Some("root"));
        assert!(project
            .scene
            .objects
            .iter()
            .any(|object| object.id().as_str() == "root"));
    }

    #[test]
    fn rejects_unknown_versions_and_invalid_resource_sizes() {
        let mut snapshot = p::ProjectSnapshot {
            schema_version: 2,
            clock: Some(clock()),
            scene_revision: 0,
            objects: vec![],
            frames: vec![],
            resources: vec![],
        };
        assert_eq!(
            decode_project(&snapshot),
            Err(ProtocolError::UnsupportedVersion)
        );
        snapshot.schema_version = 1;
        snapshot.resources.push(p::ProjectResourceRecord {
            resource_id: Some(p::ResourceId {
                value: "asset".into(),
            }),
            bytes: 8,
            class: p::ResourceClass::Cpu as i32,
            source: None,
            data: vec![1, 2, 3],
            mesh: None,
            texture: None,
            logical_only: false,
        });
        assert_eq!(
            decode_project(&snapshot),
            Err(ProtocolError::InvalidContext)
        );
    }
}
