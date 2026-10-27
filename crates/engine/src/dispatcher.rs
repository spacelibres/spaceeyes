// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Synchronous command ordering and bounded idempotency, owned at the Engine boundary.
use crate::{Engine, EngineSnapshot, EngineState};
use spaceeyes_foundation::FrameId;
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::SceneCommand;
use spaceeyes_spatial::{FrameSample, SpatialError};
use spaceeyes_time::{TimeGeneration, TimeInstant};
use std::collections::{BTreeMap, VecDeque};
#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Scene {
        expected_revision: Revision,
        commands: Vec<SceneCommand>,
    },
    RegisterMesh {
        id: spaceeyes_foundation::ResourceId,
        mesh: spaceeyes_geometry::TriangleMesh,
    },
    RegisterTexture {
        id: spaceeyes_foundation::ResourceId,
        texture: spaceeyes_geometry::TextureData,
    },
    RegisterRootFrame {
        id: FrameId,
        expected_revision: Revision,
    },
    RegisterChildFrame {
        id: FrameId,
        parent: FrameId,
        sample: FrameSample,
        expected_revision: Revision,
    },
    Start,
    Stop,
    Play,
    Pause,
    SetRate(spaceeyes_time::PlaybackRate),
    Seek(TimeInstant),
    Step(i128),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchError {
    InvalidContext,
    WrongSession,
    IdempotencyConflict,
    HistoryFull,
    Overflow,
    StaleGeneration,
    Domain(CoreError),
    Spatial(SpatialError),
    Resource(crate::ResourceError),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandReceipt {
    pub command_sequence: u64,
    pub frame_sequence: u64,
    pub scene_revision: Revision,
    pub resource_revision: u64,
    pub frame_graph_revision: Revision,
    pub session_status: SessionStatus,
}
/// Read-only status, also captured at commit time for stable lifecycle receipts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionStatus {
    pub lifecycle: EngineState,
    pub clock: spaceeyes_time::ClockSnapshot,
    pub scene_revision: Revision,
    pub frame_graph_revision: Revision,
    pub resource_revision: u64,
    pub frame_sequence: u64,
    pub object_count: u64,
    pub resource_used_bytes: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitEvent {
    pub command_sequence: u64,
    pub request_id: String,
    pub receipt: CommandReceipt,
}
#[derive(Clone)]
struct Record {
    command: Command,
    generation: Option<TimeGeneration>,
    result: Result<CommandReceipt, DispatchError>,
}
pub struct CommandDispatcher {
    engine: Engine,
    session: String,
    capacity: usize,
    sequence: u64,
    history: BTreeMap<(String, String), Record>,
    events: VecDeque<CommitEvent>,
}
impl CommandDispatcher {
    pub fn new(engine: Engine, session: String, capacity: usize) -> Result<Self, DispatchError> {
        if session.trim().is_empty() || capacity == 0 {
            return Err(DispatchError::InvalidContext);
        }
        Ok(Self {
            engine,
            session,
            capacity,
            sequence: 0,
            history: BTreeMap::new(),
            events: VecDeque::new(),
        })
    }
    pub fn engine(&self) -> &Engine {
        &self.engine
    }
    pub fn snapshot(&self) -> EngineSnapshot {
        self.engine.snapshot()
    }
    pub fn events(&self) -> impl Iterator<Item = &CommitEvent> {
        self.events.iter()
    }
    /// Host identity is already authenticated; this checks session/shape only.
    pub fn validate_context(
        &self,
        session: &str,
        principal_scope: &str,
        request_id: &str,
    ) -> Result<(), DispatchError> {
        if session != self.session {
            return Err(DispatchError::WrongSession);
        }
        if principal_scope.trim().is_empty()
            || request_id.trim().is_empty()
            || request_id.len() > 256
            || principal_scope.len() > 256
        {
            return Err(DispatchError::InvalidContext);
        }
        Ok(())
    }
    pub fn command_sequence(&self) -> u64 {
        self.sequence
    }
    pub fn session_status(&self) -> SessionStatus {
        SessionStatus {
            lifecycle: self.engine.state(),
            clock: self.engine.clock().snapshot(),
            scene_revision: self.engine.scene().revision(),
            frame_graph_revision: self.engine.spatial().revision(),
            resource_revision: self.engine.resources.revision(),
            frame_sequence: self.engine.frame_sequence,
            object_count: self.engine.scene().len() as u64,
            resource_used_bytes: self.engine.resource_used_bytes(),
        }
    }
    pub fn submit(
        &mut self,
        session: &str,
        principal_scope: &str,
        request_id: &str,
        command: Command,
    ) -> Result<CommandReceipt, DispatchError> {
        self.submit_with_generation(session, principal_scope, request_id, None, command)
    }
    pub fn submit_with_generation(
        &mut self,
        session: &str,
        principal_scope: &str,
        request_id: &str,
        generation: Option<TimeGeneration>,
        command: Command,
    ) -> Result<CommandReceipt, DispatchError> {
        self.validate_context(session, principal_scope, request_id)?;
        let key = (principal_scope.to_owned(), request_id.to_owned());
        if let Some(record) = self.history.get(&key) {
            return if record.command == command && record.generation == generation {
                record.result.clone()
            } else {
                Err(DispatchError::IdempotencyConflict)
            };
        }
        if self.history.len() >= self.capacity {
            return Err(DispatchError::HistoryFull);
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(DispatchError::Overflow)?;
        let result = if generation.is_some_and(|g| g != self.engine.clock().generation()) {
            Err(DispatchError::StaleGeneration)
        } else if let Command::RegisterRootFrame {
            id,
            expected_revision,
        } = &command
        {
            if *expected_revision != self.engine.spatial().revision() {
                Err(DispatchError::Domain(CoreError::RevisionConflict))
            } else {
                self.engine
                    .register_root_frame(id.clone())
                    .map(|_| ())
                    .map_err(DispatchError::Spatial)
            }
        } else if let Command::RegisterChildFrame {
            id,
            parent,
            sample,
            expected_revision,
        } = &command
        {
            if *expected_revision != self.engine.spatial().revision() {
                Err(DispatchError::Domain(CoreError::RevisionConflict))
            } else {
                self.engine
                    .register_child_frame(id.clone(), parent.clone(), sample.clone())
                    .map(|_| ())
                    .map_err(DispatchError::Spatial)
            }
        } else if let Command::RegisterTexture { id, texture } = &command {
            self.engine
                .register_texture_resource(id.clone(), texture.clone())
                .map_err(DispatchError::Resource)
        } else if let Command::RegisterMesh { id, mesh } = &command {
            self.engine
                .register_mesh_resource(id.clone(), mesh.clone())
                .map_err(DispatchError::Resource)
        } else {
            match &command {
                Command::RegisterRootFrame { .. }
                | Command::RegisterChildFrame { .. }
                | Command::RegisterTexture { .. }
                | Command::RegisterMesh { .. } => {
                    unreachable!("handled above")
                }
                Command::Scene {
                    expected_revision,
                    commands,
                } => self
                    .engine
                    .submit_scene(*expected_revision, commands)
                    .map(|_| ()),
                Command::Start => self.engine.start(),
                Command::Stop => {
                    self.engine.shutdown();
                    Ok(())
                }
                Command::SetRate(rate) => self.engine.set_rate(*rate),
                Command::Play => self.engine.play(),
                Command::Pause => self.engine.pause(),
                Command::Seek(t) => self.engine.seek(t.clone()),
                Command::Step(n) => self.engine.step_nanos(*n),
            }
            .map_err(DispatchError::Domain)
        }
        .map(|()| CommandReceipt {
            command_sequence: sequence,
            frame_sequence: self.engine.frame_sequence,
            scene_revision: self.engine.scene().revision(),
            resource_revision: self.engine.resources.revision(),
            frame_graph_revision: self.engine.spatial().revision(),
            session_status: self.session_status(),
        });
        self.sequence = sequence;
        if let Ok(receipt) = &result {
            if self.events.len() == self.capacity {
                self.events.pop_front();
            }
            self.events.push_back(CommitEvent {
                command_sequence: sequence,
                request_id: request_id.to_owned(),
                receipt: receipt.clone(),
            });
        }
        self.history.insert(
            key,
            Record {
                command,
                generation,
                result: result.clone(),
            },
        );
        result
    }
}
