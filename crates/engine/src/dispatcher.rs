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
    FocusCamera {
        expected_revision: Revision,
        camera: spaceeyes_foundation::ObjectId,
        target: spaceeyes_foundation::ObjectId,
        distance_m: f64,
        follow: bool,
    },
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
    presented: Option<crate::PresentedSelection>,
    #[cfg(all(feature = "gpu", target_arch = "wasm32"))]
    surface: Option<(spaceeyes_rendering::gpu::BrowserSurface, crate::LeaseId)>,
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
            presented: None,
            #[cfg(all(feature = "gpu", target_arch = "wasm32"))]
            surface: None,
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
    /// Only reads a successful presentation; never publishes a new frame or advances time.
    pub fn pick_presented(
        &self,
        sequence: u64,
        x: f32,
        y: f32,
    ) -> Result<Option<&spaceeyes_scene::SceneObject>, spaceeyes_rendering::RenderError> {
        use spaceeyes_rendering::RenderError;
        if !x.is_finite() || !y.is_finite() || x.abs() > 1.0 || y.abs() > 1.0 {
            return Err(RenderError::InvalidFrame);
        }
        self.presented.as_ref().ok_or(RenderError::StalePick)?.pick(
            &self.session_status(),
            sequence,
            x,
            y,
        )
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
    pub fn command_history_capacity(&self) -> usize {
        self.capacity
    }
    pub fn command_history_remaining(&self) -> usize {
        self.capacity - self.history.len()
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
        } else if let Command::FocusCamera {
            expected_revision,
            camera,
            target,
            distance_m,
            follow,
        } = &command
        {
            self.engine
                .focus_camera(*expected_revision, camera, target, *distance_m, *follow)
                .map(|_| ())
                .map_err(|error| match error {
                    crate::CameraControlError::Domain(e) => DispatchError::Domain(e),
                    crate::CameraControlError::Spatial(e) => DispatchError::Spatial(e),
                })
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
                Command::FocusCamera { .. }
                | Command::RegisterRootFrame { .. }
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
                    self.presented = None;
                    #[cfg(all(feature = "gpu", target_arch = "wasm32"))]
                    {
                        self.surface = None;
                    }
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

#[cfg(all(feature = "gpu", target_arch = "wasm32"))]
impl CommandDispatcher {
    pub fn install_surface(
        &mut self,
        surface: spaceeyes_rendering::gpu::BrowserSurface,
    ) -> Result<(), DispatchError> {
        if self.surface.is_some() || self.engine.state() == EngineState::Stopped {
            return Err(DispatchError::Domain(CoreError::InvalidState));
        }
        let id = spaceeyes_foundation::ResourceId::new("spaceeyes:gpu:canvas-capacity")
            .expect("static ID");
        self.engine
            .register_gpu_resource(id.clone(), spaceeyes_rendering::SURFACE_CAPACITY_BYTES)
            .map_err(DispatchError::Resource)?;
        let lease = match self.engine.lease_resource(&id) {
            Ok(l) => l,
            Err(e) => {
                let _ = self.engine.unregister_resource(&id);
                return Err(DispatchError::Resource(e));
            }
        };
        self.surface = Some((surface, lease));
        Ok(())
    }
    pub async fn present_surface(
        &mut self,
        reference: &FrameId,
        camera: &spaceeyes_foundation::ObjectId,
        width: u32,
        height: u32,
        elapsed: u64,
    ) -> Result<(SessionStatus, u64), spaceeyes_rendering::RenderError> {
        use spaceeyes_rendering::{
            prepare_camera, RenderError, MAX_CANVAS_DIMENSION, MAX_FRAME_ELAPSED_NANOS,
        };
        if self.engine.state() != EngineState::Running
            || self.surface.is_none()
            || width == 0
            || height == 0
            || width > MAX_CANVAS_DIMENSION
            || height > MAX_CANVAS_DIMENSION
            || elapsed > MAX_FRAME_ELAPSED_NANOS
        {
            return Err(RenderError::InvalidFrame);
        }
        self.engine
            .frame_sequence
            .checked_add(2)
            .ok_or(RenderError::Budget)?;
        let before_frame = self
            .engine
            .publish_frame(reference)
            .map_err(|_| RenderError::InvalidFrame)?;
        prepare_camera(&before_frame, camera, f64::from(width) / f64::from(height))?;
        self.engine
            .advance_nanos(elapsed)
            .map_err(|_| RenderError::InvalidFrame)?;
        let snapshot = self
            .engine
            .publish_frame(reference)
            .map_err(|_| RenderError::InvalidFrame)?;
        let unresolved = snapshot.unresolved.len() as u64;
        let prepared = prepare_camera(&snapshot, camera, f64::from(width) / f64::from(height))?;
        let before = self.engine.resources.revision();
        // Once a new presentation is attempted an older image is not safe to query.
        self.presented = None;
        let result = self
            .surface
            .as_mut()
            .expect("validated surface")
            .0
            .render(&prepared, width, height, &mut self.engine.resources)
            .await;
        if self.engine.resources.revision() != before {
            self.engine.frame_sequence += 1;
        }
        result?;
        let state = self.session_status();
        self.presented = Some(crate::PresentedSelection::new(
            &snapshot,
            prepared,
            state.clone(),
        ));
        Ok((state, unresolved))
    }
}
