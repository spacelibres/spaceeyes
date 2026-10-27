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
    BeginUpload {
        descriptor: spaceeyes_resources::UploadDescriptor,
    },
    AppendUpload {
        upload_id: String,
        offset: u64,
        data: Vec<u8>,
    },
    FinishUpload {
        upload_id: String,
    },
    CancelUpload {
        upload_id: String,
    },
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
    pub upload: Option<spaceeyes_resources::UploadStatus>,
    pub upload_resource: Option<spaceeyes_foundation::ResourceId>,
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
enum RecordedCommand {
    AppendUpload {
        upload_id: String,
        offset: u64,
        length: usize,
        sha256: [u8; 32],
    },
    Other(Command),
}
impl RecordedCommand {
    fn from_command(command: Command) -> Self {
        match command {
            Command::AppendUpload {
                upload_id,
                offset,
                data,
            } => Self::AppendUpload {
                upload_id,
                offset,
                length: data.len(),
                sha256: spaceeyes_resources::upload_digest(&data),
            },
            other => Self::Other(other),
        }
    }
    fn matches(&self, command: &Command) -> bool {
        match (self, command) {
            (
                Self::AppendUpload {
                    upload_id,
                    offset,
                    length,
                    sha256,
                },
                Command::AppendUpload {
                    upload_id: id,
                    offset: start,
                    data,
                },
            ) => {
                upload_id == id
                    && offset == start
                    && *length == data.len()
                    && *sha256 == spaceeyes_resources::upload_digest(data)
            }
            (Self::Other(other), command) => other == command,
            _ => false,
        }
    }
}
const CLEANUP_HISTORY_CAPACITY: usize = spaceeyes_resources::MAX_UPLOAD_SESSIONS + 1;

#[derive(Clone)]
struct Record {
    command: RecordedCommand,
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
    // Once normal history fills, only successful cleanup can consume these fixed slots.
    cleanup_history: BTreeMap<(String, String), Record>,
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
            cleanup_history: BTreeMap::new(),
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
        if let Some(record) = self
            .history
            .get(&key)
            .or_else(|| self.cleanup_history.get(&key))
        {
            return if record.command.matches(&command) && record.generation == generation {
                record.result.clone()
            } else {
                Err(DispatchError::IdempotencyConflict)
            };
        }
        let cleanup_only = self.history.len() >= self.capacity;
        if cleanup_only
            && (!matches!(&command, Command::CancelUpload { .. } | Command::Stop)
                || self.cleanup_history.len() >= CLEANUP_HISTORY_CAPACITY)
        {
            return Err(DispatchError::HistoryFull);
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(DispatchError::Overflow)?;
        let mut upload = None;
        let mut upload_resource = None;
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
        } else if let Command::BeginUpload { descriptor } = &command {
            self.engine
                .begin_upload(principal_scope, descriptor.clone())
                .map(|status| {
                    upload = Some(status);
                })
                .map_err(DispatchError::Resource)
        } else if let Command::AppendUpload {
            upload_id,
            offset,
            data,
        } = &command
        {
            self.engine
                .append_upload(principal_scope, upload_id, *offset, data)
                .map(|status| {
                    upload = Some(status);
                })
                .map_err(DispatchError::Resource)
        } else if let Command::FinishUpload { upload_id } = &command {
            self.engine
                .finish_upload(principal_scope, upload_id)
                .map(|id| {
                    upload_resource = Some(id);
                })
                .map_err(DispatchError::Resource)
        } else if let Command::CancelUpload { upload_id } = &command {
            self.engine
                .cancel_upload(principal_scope, upload_id)
                .map(|id| {
                    upload_resource = Some(id);
                })
                .map_err(DispatchError::Resource)
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
                Command::BeginUpload { .. }
                | Command::AppendUpload { .. }
                | Command::FinishUpload { .. }
                | Command::CancelUpload { .. }
                | Command::FocusCamera { .. }
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
            upload,
            upload_resource,
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
        // Failed cleanup must not prevent valid owners from releasing existing uploads.
        if !cleanup_only || result.is_ok() {
            let history = if cleanup_only {
                &mut self.cleanup_history
            } else {
                &mut self.history
            };
            history.insert(
                key,
                Record {
                    command: RecordedCommand::from_command(command),
                    generation,
                    result: result.clone(),
                },
            );
        }
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

#[cfg(test)]
mod upload_history_tests {
    use super::*;
    use spaceeyes_foundation::ResourceId;
    use spaceeyes_resources::{ResourceError, UploadDescriptor, UploadFormat, UploadSource};

    fn dispatcher(capacity: usize) -> CommandDispatcher {
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap()),
            "session".into(),
            capacity,
        )
        .unwrap()
    }
    fn begin(d: &mut CommandDispatcher, request: &str) -> String {
        d.submit(
            "session",
            "alice",
            request,
            Command::BeginUpload {
                descriptor: UploadDescriptor {
                    resource_id: ResourceId::new(request).unwrap(),
                    total_bytes: 3,
                    source: UploadSource {
                        source_id: "fixture".into(),
                        source_version: "1".into(),
                        sha256: [0; 32],
                    },
                    format: UploadFormat::Blob,
                },
            },
        )
        .unwrap()
        .upload
        .unwrap()
        .upload_id
    }
    fn append(upload_id: &str, offset: u64, data: &[u8]) -> Command {
        Command::AppendUpload {
            upload_id: upload_id.into(),
            offset,
            data: data.to_vec(),
        }
    }
    fn assert_released(d: &CommandDispatcher) {
        let usage = d.engine().resource_usage();
        assert_eq!(usage.cpu_bytes, 0);
        assert_eq!(usage.staging_bytes, 0);
    }
    fn assert_fingerprint(d: &CommandDispatcher, request: &str, expected_id: &str) {
        match &d
            .history
            .get(&("alice".into(), request.into()))
            .unwrap()
            .command
        {
            RecordedCommand::AppendUpload {
                upload_id,
                offset,
                length,
                sha256,
            } => {
                assert_eq!(upload_id, expected_id);
                assert_eq!(*offset, 0);
                assert_eq!(*length, 3);
                assert_eq!(
                    *sha256,
                    [
                        0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde,
                        0x5d, 0xae, 0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c,
                        0xb4, 0x10, 0xff, 0x61, 0xf2, 0x00, 0x15, 0xad,
                    ]
                );
            }
            RecordedCommand::Other(_) => panic!("upload history retained the original command"),
        }
    }
    #[test]
    fn append_history_drops_payload_after_cancel_stop_and_invalid_upload() {
        for stop in [false, true] {
            let mut d = dispatcher(8);
            let id = begin(&mut d, "begin");
            let receipt = d.submit("session", "alice", "append", append(&id, 0, b"abc"));
            assert_eq!(
                d.submit("session", "alice", "append", append(&id, 0, b"abc")),
                receipt
            );
            for changed in [
                append(&id, 0, b"abd"),
                append(&id, 1, b"abc"),
                append(&id, 0, b"ab"),
                append("other", 0, b"abc"),
            ] {
                assert_eq!(
                    d.submit("session", "alice", "append", changed),
                    Err(DispatchError::IdempotencyConflict)
                );
            }
            let cleanup = if stop {
                Command::Stop
            } else {
                Command::CancelUpload {
                    upload_id: id.clone(),
                }
            };
            d.submit("session", "alice", "cleanup", cleanup).unwrap();
            assert_released(&d);
            assert_eq!(
                d.submit("session", "alice", "append", append(&id, 0, b"abc")),
                receipt
            );
            // No history record may retain a chunk, even after its session is gone.
            assert_fingerprint(&d, "append", &id);
        }
    }
    #[test]
    fn invalid_upload_append_history_drops_payload() {
        let mut d = dispatcher(2);
        let rejected = d.submit("session", "alice", "invalid", append("missing", 0, b"abc"));
        assert_eq!(
            rejected,
            Err(DispatchError::Resource(ResourceError::InvalidUpload))
        );
        assert_eq!(
            d.submit("session", "alice", "invalid", append("missing", 0, b"abc")),
            rejected
        );
        assert_fingerprint(&d, "invalid", "missing");
    }
    #[test]
    fn full_history_allows_idempotent_cancel_without_spending_normal_capacity() {
        let mut d = dispatcher(1);
        let id = begin(&mut d, "begin");
        assert_eq!(d.command_history_remaining(), 0);
        let command = Command::CancelUpload { upload_id: id };
        let receipt = d
            .submit("session", "alice", "cancel", command.clone())
            .unwrap();
        assert_eq!(d.submit("session", "alice", "cancel", command), Ok(receipt));
        assert_released(&d);
        assert_eq!(d.command_history_capacity(), 1);
        assert_eq!(d.command_history_remaining(), 0);
        assert_eq!(
            d.submit("session", "alice", "write", Command::Start),
            Err(DispatchError::HistoryFull)
        );
        assert_eq!(
            d.submit("session", "alice", "cancel", Command::Stop),
            Err(DispatchError::IdempotencyConflict)
        );
        assert_eq!(d.events().count(), 1);
    }
    #[test]
    fn invalid_or_unauthorized_cancels_cannot_exhaust_cleanup_capacity() {
        let mut d = dispatcher(1);
        let id = begin(&mut d, "begin");
        for n in 0..16 {
            assert_eq!(
                d.submit(
                    "session",
                    "alice",
                    &format!("invalid-{n}"),
                    Command::CancelUpload {
                        upload_id: "missing".into()
                    }
                ),
                Err(DispatchError::Resource(ResourceError::InvalidUpload))
            );
            assert_eq!(
                d.submit(
                    "session",
                    "bob",
                    &format!("foreign-{n}"),
                    Command::CancelUpload {
                        upload_id: id.clone()
                    }
                ),
                Err(DispatchError::Resource(ResourceError::PermissionDenied))
            );
        }
        assert!(d.cleanup_history.is_empty());
        assert_eq!(
            d.engine()
                .upload_status("alice", &id)
                .unwrap()
                .received_bytes,
            0
        );
        d.submit(
            "session",
            "alice",
            "cancel",
            Command::CancelUpload { upload_id: id },
        )
        .unwrap();
        assert_released(&d);
    }
    #[test]
    fn full_history_stop_releases_all_uploads_and_has_a_stable_receipt() {
        let mut d = dispatcher(4);
        for n in 0..4 {
            begin(&mut d, &format!("begin-{n}"));
        }
        let receipt = d.submit("session", "alice", "stop", Command::Stop).unwrap();
        assert_eq!(
            d.submit("session", "alice", "stop", Command::Stop),
            Ok(receipt)
        );
        assert_eq!(d.engine().state(), EngineState::Stopped);
        assert_released(&d);
        assert_eq!(d.command_history_remaining(), 0);
    }
    #[test]
    fn full_history_can_cancel_all_four_uploads_then_stop() {
        let mut d = dispatcher(4);
        let ids: Vec<_> = (0..4)
            .map(|n| begin(&mut d, &format!("begin-{n}")))
            .collect();
        for (n, id) in ids.into_iter().enumerate() {
            let command = Command::CancelUpload { upload_id: id };
            let request = format!("cancel-{n}");
            let receipt = d
                .submit("session", "alice", &request, command.clone())
                .unwrap();
            assert_eq!(d.submit("session", "alice", &request, command), Ok(receipt));
        }
        assert_released(&d);
        d.submit("session", "alice", "stop", Command::Stop).unwrap();
        assert_eq!(
            d.submit("session", "alice", "extra-stop", Command::Stop),
            Err(DispatchError::HistoryFull)
        );
        assert_eq!(d.history.len(), 4);
        assert_eq!(d.cleanup_history.len(), CLEANUP_HISTORY_CAPACITY);
        assert_eq!(d.events().count(), 4);
    }
}
