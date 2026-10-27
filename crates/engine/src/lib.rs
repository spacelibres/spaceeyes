//! Engine owns session lifecycle, scene command entry, and consistent read snapshots.
use spaceeyes_foundation::FrameId;
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_foundation::{ObjectId, ResourceId};
use spaceeyes_resources::{LeaseId, ResourceBudget, ResourceError, ResourceManager};
use spaceeyes_scene::{Scene, SceneCommand, SceneSnapshot};
use spaceeyes_simulation::{
    dispatch_ready, enqueue_bounded, SimulationScheduler, TaskBudget, TaskError, TaskExecutor,
    TaskProvenance, TaskRequest, TaskResult, TaskStatus,
};
use spaceeyes_spatial::{
    FrameSample, ProviderRef, ReferenceFrameGraph, RigidTransform, SpatialError,
};
use spaceeyes_time::{SimulationClock, TimeGeneration, TimeInstant};
use std::collections::{BTreeMap, HashMap};
mod dispatcher;
pub use dispatcher::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineState {
    Ready,
    Running,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineSnapshot {
    pub scene: SceneSnapshot,
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub sequence: u64,
    pub frame_graph_revision: Revision,
    pub resource_revision: u64,
}

/// A host executor reports a terminal outcome or a computed result.
/// This is not a Scene write; successful results still require commit_task_scene.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExecutorFeedback {
    Result(TaskResult),
    Failed { task_id: String },
    Cancelled { task_id: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitTaskError {
    EngineStopped,
    Task(TaskError),
    Scene(CoreError),
}

/// Internal persistence slice. External project files must use the versioned Proto contract.
#[derive(Clone, Debug, PartialEq)]
pub struct ProjectState {
    pub schema_version: u32,
    pub scene: SceneSnapshot,
    pub clock: spaceeyes_time::ClockSnapshot,
    pub frames: Vec<spaceeyes_spatial::FrameRecord>,
    pub resources: Vec<spaceeyes_resources::ResourceRecord>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RestoreError {
    UnsupportedVersion,
    Scene(CoreError),
    Spatial(SpatialError),
    Resource(ResourceError),
}
pub struct Engine {
    state: EngineState,
    scene: Scene,
    clock: SimulationClock,
    spatial: ReferenceFrameGraph,
    simulation: SimulationScheduler,
    task_budget: TaskBudget,
    resources: ResourceManager,
    task_leases: BTreeMap<String, Vec<LeaseId>>,
    object_leases: HashMap<ObjectId, Vec<LeaseId>>,
    frame_sequence: u64,
}
impl Engine {
    pub fn new(instant: TimeInstant) -> Self {
        Self {
            state: EngineState::Ready,
            scene: Scene::new(),
            clock: SimulationClock::new(instant),
            spatial: ReferenceFrameGraph::new(),
            simulation: SimulationScheduler::new(),
            task_budget: TaskBudget::new(4, 1024).expect("valid built-in task budget"),
            resources: ResourceManager::new(ResourceBudget {
                max_bytes: 256 * 1024 * 1024,
            }),
            task_leases: BTreeMap::new(),
            object_leases: HashMap::new(),
            frame_sequence: 0,
        }
    }
    pub fn project_state(&self) -> ProjectState {
        ProjectState {
            schema_version: 1,
            scene: self.scene.snapshot(),
            clock: self.clock.snapshot(),
            frames: self.spatial.records(),
            resources: self.resources.records(),
        }
    }
    pub fn restore_project(
        project: &ProjectState,
        providers: &[ProviderRef],
    ) -> Result<Self, RestoreError> {
        if project.schema_version != 1 {
            return Err(RestoreError::UnsupportedVersion);
        }
        let mut engine = Self::new(project.clock.instant.clone());
        engine.clock = SimulationClock::restore(&project.clock).map_err(RestoreError::Scene)?;
        engine.spatial = ReferenceFrameGraph::restore(&project.frames, providers)
            .map_err(RestoreError::Spatial)?;
        engine.resources = ResourceManager::restore(
            ResourceBudget {
                max_bytes: 256 * 1024 * 1024,
            },
            &project.resources,
        )
        .map_err(RestoreError::Resource)?;
        let commands: Vec<_> = project
            .scene
            .objects
            .iter()
            .cloned()
            .map(SceneCommand::Create)
            .collect();
        // Restoration preserves unresolved frame/resource references rather than inventing data.
        engine
            .scene
            .apply_transaction(Revision(0), &commands)
            .map_err(RestoreError::Scene)?;
        for object in &project.scene.objects {
            let mut leases = Vec::new();
            for id in object.resources() {
                leases.push(
                    engine
                        .resources
                        .lease_reference(id)
                        .map_err(RestoreError::Resource)?,
                );
            }
            if !leases.is_empty() {
                engine.object_leases.insert(object.id().clone(), leases);
            }
        }
        engine.frame_sequence = 1;
        Ok(engine)
    }
    pub fn state(&self) -> EngineState {
        self.state
    }
    pub fn scene(&self) -> &Scene {
        &self.scene
    }
    pub fn clock(&self) -> &SimulationClock {
        &self.clock
    }
    pub fn spatial(&self) -> &ReferenceFrameGraph {
        &self.spatial
    }
    pub fn resource_used_bytes(&self) -> u64 {
        self.resources.used_bytes()
    }
    pub fn task_status(&self, id: &str) -> Option<TaskStatus> {
        self.simulation.status(id)
    }
    pub fn snapshot(&self) -> EngineSnapshot {
        EngineSnapshot {
            scene: self.scene.snapshot(),
            instant: self.clock.instant().clone(),
            generation: self.clock.generation(),
            sequence: self.frame_sequence,
            frame_graph_revision: self.spatial.revision(),
            resource_revision: self.resources.revision(),
        }
    }
    /// Capture time-explicit poses and every revision in one immutable value.
    /// Missing references are explicit; no zero-position scientific state is invented.
    pub fn publish_frame(
        &self,
        reference: &FrameId,
    ) -> Result<spaceeyes_snapshot::FrameSnapshot, SpatialError> {
        use spaceeyes_snapshot::{FrameAvailability, FrameSnapshot, ObjectPose};
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        if !self.spatial.contains(reference) {
            return Err(SpatialError::UnknownFrame);
        }
        let scene = self.scene.snapshot();
        let clock = self.clock.snapshot();
        let mut poses = Vec::new();
        let mut unresolved = Vec::new();
        for object in &scene.objects {
            if object.resources().iter().any(|id| {
                !matches!(
                    self.resources.state(id),
                    Some(
                        spaceeyes_resources::ResourceState::Registered
                            | spaceeyes_resources::ResourceState::Ready
                    )
                )
            }) {
                unresolved.push(object.id().clone());
                continue;
            }
            match object
                .frame()
                .and_then(|frame| self.spatial.resolve(frame, reference, &clock.instant).ok())
            {
                Some(transform) => poses.push(ObjectPose {
                    object: object.id().clone(),
                    transform,
                }),
                None => unresolved.push(object.id().clone()),
            }
        }
        Ok(FrameSnapshot {
            sequence: self.frame_sequence,
            scene,
            clock,
            reference: reference.clone(),
            frame_graph_revision: self.spatial.revision(),
            resource_revision: self.resources.revision(),
            availability: if unresolved.is_empty() {
                FrameAvailability::Complete
            } else {
                FrameAvailability::Partial
            },
            poses,
            unresolved,
        })
    }
    /// Coordinate one native draw using the same authoritative resource registry as Scene/tasks.
    #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
    pub fn render_rgba8(
        &mut self,
        renderer: &spaceeyes_rendering::gpu::GpuRenderer,
        reference: &FrameId,
        camera: &ObjectId,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, spaceeyes_rendering::RenderError> {
        use spaceeyes_rendering::{prepare_camera, RenderError};
        if self.state != EngineState::Running || width == 0 || height == 0 {
            return Err(RenderError::InvalidFrame);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(RenderError::Budget)?;
        let snapshot = self
            .publish_frame(reference)
            .map_err(|_| RenderError::InvalidFrame)?;
        let prepared = prepare_camera(&snapshot, camera, f64::from(width) / f64::from(height))?;
        let before = self.resources.revision();
        let result = renderer.render_rgba8(&prepared, width, height, &mut self.resources);
        if self.resources.revision() != before {
            self.frame_sequence = sequence;
        }
        result
    }
    pub fn start(&mut self) -> Result<(), CoreError> {
        if self.state != EngineState::Ready {
            return Err(CoreError::InvalidState);
        }
        self.state = EngineState::Running;
        Ok(())
    }
    /// The only Engine-facing scene write path. A future protocol adapter will call this.
    pub fn submit_scene(
        &mut self,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        // Stage every change, including lease identities, before publishing either registry.
        let mut scene = self.scene.clone();
        let next = scene.apply_transaction(expected_revision, commands)?;
        if commands.is_empty() {
            return Ok(next);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        for command in commands {
            let frame = match command {
                SceneCommand::SetFrame { frame, .. } => frame.as_ref(),
                SceneCommand::Create(object) => object.frame(),
                SceneCommand::SetCamera {
                    object,
                    camera: Some(_),
                }
                | SceneCommand::SetSphere {
                    object,
                    sphere: Some(_),
                } => Some(
                    scene
                        .get(object)
                        .ok_or(CoreError::UnknownObject)?
                        .frame()
                        .ok_or(CoreError::UnknownFrame)?,
                ),
                _ => None,
            };
            if frame.is_some_and(|id| !self.spatial.contains(id)) {
                return Err(CoreError::UnknownFrame);
            }
        }
        for command in commands {
            let id = match command {
                SceneCommand::Create(object) => Some(object.id()),
                SceneCommand::SetFrame { object, .. }
                | SceneCommand::SetCamera { object, .. }
                | SceneCommand::SetSphere { object, .. } => Some(object),
                _ => None,
            };
            if let Some(object) = id.and_then(|id| scene.get(id)) {
                if (object.camera().is_some() || object.sphere().is_some())
                    && object.frame().is_none()
                {
                    return Err(CoreError::UnknownFrame);
                }
            }
        }
        let mut resources = self.resources.clone();
        for leases in self.object_leases.values() {
            for lease in leases {
                resources
                    .release_lease(lease)
                    .map_err(|_| CoreError::ResourceUnavailable)?;
            }
        }
        let mut object_leases = HashMap::new();
        for object in scene.snapshot().objects {
            let mut leases = Vec::new();
            for id in object.resources() {
                let lease = match resources.lease(id) {
                    Ok(lease) => lease,
                    Err(ResourceError::NotReady)
                        if scene.handle(object.id()) == self.scene.handle(object.id())
                            && self
                                .scene
                                .get(object.id())
                                .is_some_and(|previous| previous.resources().contains(id)) =>
                    {
                        resources
                            .lease_reference(id)
                            .map_err(|_| CoreError::ResourceUnavailable)?
                    }
                    Err(_) => return Err(CoreError::ResourceUnavailable),
                };
                leases.push(lease);
            }
            if !leases.is_empty() {
                object_leases.insert(object.id().clone(), leases);
            }
        }
        self.scene = scene;
        self.resources = resources;
        self.object_leases = object_leases;
        self.frame_sequence = sequence;
        Ok(next)
    }
    pub fn seek(&mut self, instant: TimeInstant) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.seek(instant)?;
        self.simulation
            .invalidate_generation(self.clock.generation());
        self.release_terminal_task_leases();
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn play(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        if self.clock.mode() == spaceeyes_time::ClockMode::Playing {
            return Ok(());
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.play()?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn pause(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        if self.clock.mode() == spaceeyes_time::ClockMode::Paused {
            return Ok(());
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.pause()?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn step_nanos(&mut self, delta: i128) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        if delta == 0 {
            return Ok(());
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.step_nanos(delta)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn set_rate(&mut self, rate: spaceeyes_time::PlaybackRate) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        if self.clock.snapshot().rate == rate {
            return Ok(());
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.set_rate(rate)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    /// Host-driven rational-rate playback, separate from explicit simulation steps.
    pub fn advance_nanos(&mut self, elapsed_nanos: u64) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped {
            return Err(CoreError::AlreadyStopped);
        }
        if self.clock.mode() == spaceeyes_time::ClockMode::Paused
            || elapsed_nanos == 0
            || self.clock.snapshot().rate.numerator() == 0
        {
            return Ok(());
        }
        let next_sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(CoreError::InvalidState)?;
        self.clock.advance_nanos(elapsed_nanos)?;
        self.frame_sequence = next_sequence;
        Ok(())
    }
    pub fn register_resource(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.resources.register(id, bytes)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn lease_resource(&mut self, id: &ResourceId) -> Result<LeaseId, ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        self.resources.lease(id)
    }
    pub fn release_resource_lease(&mut self, token: &LeaseId) -> Result<(), ResourceError> {
        self.resources.release_lease(token)
    }
    pub fn unregister_resource(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.resources.unregister(id)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    /// Register a task for the current authoritative time generation.
    pub fn enqueue_task(&mut self, request: TaskRequest) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        if request.generation != self.clock.generation() {
            return Err(TaskError::StaleGeneration);
        }
        enqueue_bounded(&mut self.simulation, self.task_budget, request)
    }
    pub fn bind_task_provenance(
        &mut self,
        id: &str,
        provenance: TaskProvenance,
    ) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        if provenance.scene_revision != self.scene.revision()
            || provenance.frame_graph_revision != self.spatial.revision()
        {
            return Err(TaskError::RevisionMismatch);
        }
        self.simulation.bind_provenance(id, provenance)
    }
    pub fn ready_tasks(&self) -> Vec<String> {
        self.simulation.ready_tasks()
    }
    /// A host-provided executor handles actual work; Engine only issues ready tasks.
    pub fn dispatch_tasks(
        &mut self,
        executor: &mut impl TaskExecutor,
    ) -> Result<Vec<String>, TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        let result = dispatch_ready(&mut self.simulation, self.task_budget, executor);
        self.release_terminal_task_leases();
        result
    }
    pub fn start_task(&mut self, id: &str) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        if self.simulation.active_count() >= self.task_budget.max_in_flight {
            return Err(TaskError::InFlightFull);
        }
        self.simulation.start(id)
    }
    pub fn forget_terminal_task(&mut self, id: &str) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        self.simulation.forget_terminal(id)?;
        self.release_task_leases(id);
        Ok(())
    }
    pub fn cancel_task(&mut self, id: &str) -> Result<(), TaskError> {
        self.simulation.cancel(id)?;
        self.release_terminal_task_leases();
        Ok(())
    }
    /// Mark cancellation first, then notify host; a failed notification cannot
    /// re-enable a cancelled task or permit its late result to commit.
    pub fn cancel_task_with_executor(
        &mut self,
        id: &str,
        executor: &mut impl TaskExecutor,
    ) -> Result<(), TaskError> {
        self.cancel_task(id)?;
        executor.request_cancel(id)
    }
    pub fn fail_task(&mut self, id: &str) -> Result<(), TaskError> {
        self.simulation.fail(id)?;
        self.release_terminal_task_leases();
        Ok(())
    }
    /// Attach a logical resource lease to an existing nonterminal task.
    /// The task's lease is owned by Engine, not by the executor or Scene.
    pub fn attach_task_resource(
        &mut self,
        task_id: &str,
        id: &ResourceId,
    ) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        match self.simulation.status(task_id) {
            Some(TaskStatus::Queued | TaskStatus::Running | TaskStatus::ResultReady) => {}
            _ => return Err(ResourceError::InvalidLease),
        }
        let lease = self.resources.lease(id)?;
        self.task_leases
            .entry(task_id.to_owned())
            .or_default()
            .push(lease);
        Ok(())
    }
    fn release_task_leases(&mut self, task_id: &str) {
        if let Some(resources) = self.task_leases.remove(task_id) {
            for token in resources {
                // Task-specific tokens cannot release another holder's lease.
                let _ = self.resources.release_lease(&token);
            }
        }
    }
    fn release_terminal_task_leases(&mut self) {
        let ids: Vec<String> = self
            .task_leases
            .keys()
            .filter(|id| {
                matches!(
                    self.simulation.status(id),
                    Some(
                        TaskStatus::Completed
                            | TaskStatus::Cancelled
                            | TaskStatus::Failed
                            | TaskStatus::Stale
                    )
                )
            })
            .cloned()
            .collect();
        for id in ids {
            self.release_task_leases(&id);
        }
    }
    /// Result acceptance does not mutate Scene or claim a completed transaction.
    pub fn accept_task_result(&mut self, result: &TaskResult) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        let outcome =
            self.simulation
                .accept_result(result, self.clock.generation(), self.clock.instant());
        self.release_terminal_task_leases();
        outcome
    }
    /// Accept host feedback through the same task state machine.
    /// Late results and terminal-state changes are rejected by Simulation.
    pub fn receive_executor_feedback(
        &mut self,
        feedback: ExecutorFeedback,
    ) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped {
            return Err(TaskError::InvalidState);
        }
        match feedback {
            ExecutorFeedback::Result(result) => self.accept_task_result(&result),
            ExecutorFeedback::Failed { task_id } => self.fail_task(&task_id),
            ExecutorFeedback::Cancelled { task_id } => self.cancel_task(&task_id),
        }
    }
    /// Commit a validated result through the sole Scene transaction path.
    /// A failed Scene transaction leaves the task ResultReady for explicit retry/cancel.
    pub fn commit_task_scene(
        &mut self,
        task_id: &str,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CommitTaskError> {
        if self.state == EngineState::Stopped {
            return Err(CommitTaskError::EngineStopped);
        }
        self.simulation
            .validate_commit(task_id, self.clock.generation(), self.clock.instant())
            .map_err(CommitTaskError::Task)?;
        self.simulation
            .validate_provenance(task_id, self.scene.revision(), self.spatial.revision())
            .map_err(CommitTaskError::Task)?;
        let revision = self
            .submit_scene(expected_revision, commands)
            .map_err(CommitTaskError::Scene)?;
        self.simulation
            .complete(task_id)
            .map_err(CommitTaskError::Task)?;
        self.release_task_leases(task_id);
        Ok(revision)
    }
    /// All spatial graph writes pass through Engine, never through plugins.
    pub fn register_root_frame(&mut self, id: FrameId) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        let next_sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_root(id)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn register_child_frame(
        &mut self,
        id: FrameId,
        parent: FrameId,
        sample: FrameSample,
    ) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        let next_sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_child(id, parent, sample)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn register_dynamic_frame(
        &mut self,
        id: FrameId,
        parent: FrameId,
        provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        let next = self
            .frame_sequence
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_dynamic_child(id, parent, provider)?;
        self.frame_sequence = next;
        Ok(revision)
    }
    pub fn replace_frame_provider(
        &mut self,
        id: &FrameId,
        provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        let next = self
            .frame_sequence
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.replace_provider(id, provider)?;
        self.frame_sequence = next;
        Ok(revision)
    }
    pub fn resolve_frame(
        &self,
        source: &FrameId,
        target: &FrameId,
        instant: &TimeInstant,
    ) -> Result<RigidTransform, SpatialError> {
        self.spatial.resolve(source, target, instant)
    }
    pub fn remove_frame(&mut self, id: &FrameId) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped {
            return Err(SpatialError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.remove(id)?;
        self.frame_sequence = sequence;
        Ok(revision)
    }
    pub fn declare_resource(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.resources.declare(id, bytes)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn begin_resource_load(
        &mut self,
        id: &ResourceId,
    ) -> Result<spaceeyes_resources::LoadToken, ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let token = self.resources.begin_load(id)?;
        self.frame_sequence = sequence;
        Ok(token)
    }
    pub fn finish_resource_load(
        &mut self,
        token: &spaceeyes_resources::LoadToken,
        data: Vec<u8>,
    ) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.resources.complete_load(token, data)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn cancel_resource_load(
        &mut self,
        token: &spaceeyes_resources::LoadToken,
    ) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        let sequence = self
            .frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.resources.cancel_load(token)?;
        self.frame_sequence = sequence;
        Ok(())
    }
    pub fn resource_bytes(&self, lease: &LeaseId) -> Result<&[u8], ResourceError> {
        self.resources.read(lease)
    }
    pub fn shutdown(&mut self) {
        self.simulation.cancel_all();
        self.release_terminal_task_leases();
        self.object_leases.clear();
        self.resources.clear();
        self.state = EngineState::Stopped;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_foundation::ObjectId;
    use spaceeyes_scene::SceneObject;
    use spaceeyes_spatial::{Quatd, Vec3d};

    fn instant() -> TimeInstant {
        TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap()
    }
    #[test]
    fn executor_feedback_rejects_late_results_after_cancel() {
        let mut engine = Engine::new(instant());
        let request = TaskRequest {
            task_id: "feedback-task".into(),
            generation: TimeGeneration(0),
            requested_instant: instant(),
            dependencies: vec![],
        };
        engine.enqueue_task(request).unwrap();
        engine.start_task("feedback-task").unwrap();
        engine
            .receive_executor_feedback(ExecutorFeedback::Cancelled {
                task_id: "feedback-task".into(),
            })
            .unwrap();
        assert_eq!(
            engine.receive_executor_feedback(ExecutorFeedback::Result(TaskResult {
                task_id: "feedback-task".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
            })),
            Err(TaskError::InvalidState)
        );
        assert_eq!(
            engine.task_status("feedback-task"),
            Some(TaskStatus::Cancelled)
        );
    }
    #[test]
    fn executor_feedback_result_requires_scene_commit() {
        let mut engine = Engine::new(instant());
        engine
            .enqueue_task(TaskRequest {
                task_id: "feedback-success".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
                dependencies: vec![],
            })
            .unwrap();
        engine.start_task("feedback-success").unwrap();
        engine
            .receive_executor_feedback(ExecutorFeedback::Result(TaskResult {
                task_id: "feedback-success".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
            }))
            .unwrap();
        assert_eq!(
            engine.task_status("feedback-success"),
            Some(TaskStatus::ResultReady)
        );
        engine
            .commit_task_scene("feedback-success", Revision(0), &[])
            .unwrap();
        assert_eq!(
            engine.task_status("feedback-success"),
            Some(TaskStatus::Completed)
        );
    }
    #[test]
    fn task_leases_release_on_cancel_seek_and_commit() {
        let mut engine = Engine::new(instant());
        let resource = ResourceId::new("data:sample").unwrap();
        engine.register_resource(resource.clone(), 10).unwrap();
        for task_id in ["cancel", "seek", "commit"] {
            engine
                .enqueue_task(TaskRequest {
                    task_id: task_id.into(),
                    generation: engine.clock().generation(),
                    requested_instant: engine.clock().instant().clone(),
                    dependencies: vec![],
                })
                .unwrap();
            engine.attach_task_resource(task_id, &resource).unwrap();
        }
        assert_eq!(
            engine.unregister_resource(&resource),
            Err(ResourceError::StillLeased)
        );
        engine.cancel_task("cancel").unwrap();
        engine.start_task("commit").unwrap();
        engine
            .accept_task_result(&TaskResult {
                task_id: "commit".into(),
                generation: engine.clock().generation(),
                requested_instant: engine.clock().instant().clone(),
            })
            .unwrap();
        engine
            .commit_task_scene("commit", Revision(0), &[])
            .unwrap();
        assert_eq!(
            engine.unregister_resource(&resource),
            Err(ResourceError::StillLeased)
        );
        engine.seek(instant()).unwrap();
        engine.unregister_resource(&resource).unwrap();
    }
    #[test]
    fn stepping_time_blocks_result_commit_even_without_generation_change() {
        let mut engine = Engine::new(instant());
        engine
            .enqueue_task(TaskRequest {
                task_id: "step-task".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
                dependencies: vec![],
            })
            .unwrap();
        engine.start_task("step-task").unwrap();
        engine
            .accept_task_result(&TaskResult {
                task_id: "step-task".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
            })
            .unwrap();
        engine.step_nanos(1).unwrap();
        assert_eq!(
            engine.commit_task_scene("step-task", Revision(0), &[]),
            Err(CommitTaskError::Task(TaskError::WrongInstant))
        );
    }
    #[test]
    fn seek_invalidates_tasks_and_prevents_late_commit() {
        let mut engine = Engine::new(instant());
        engine
            .enqueue_task(TaskRequest {
                task_id: "task-a".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
                dependencies: vec![],
            })
            .unwrap();
        engine.start_task("task-a").unwrap();
        engine.seek(instant()).unwrap();
        assert_eq!(engine.task_status("task-a"), Some(TaskStatus::Stale));
        assert_eq!(
            engine.commit_task_scene("task-a", Revision(0), &[]),
            Err(CommitTaskError::Task(TaskError::InvalidState))
        );
    }
    #[test]
    fn result_commits_only_through_scene_transaction() {
        let mut engine = Engine::new(instant());
        engine
            .enqueue_task(TaskRequest {
                task_id: "task-b".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
                dependencies: vec![],
            })
            .unwrap();
        engine.start_task("task-b").unwrap();
        engine
            .accept_task_result(&TaskResult {
                task_id: "task-b".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
            })
            .unwrap();
        let id = ObjectId::new("demo:moon").unwrap();
        assert_eq!(
            engine.commit_task_scene(
                "task-b",
                Revision(9),
                &[SceneCommand::Create(SceneObject::new(id.clone()))]
            ),
            Err(CommitTaskError::Scene(CoreError::RevisionConflict))
        );
        assert_eq!(engine.task_status("task-b"), Some(TaskStatus::ResultReady));
        engine
            .commit_task_scene(
                "task-b",
                Revision(0),
                &[SceneCommand::Create(SceneObject::new(id))],
            )
            .unwrap();
        assert_eq!(engine.task_status("task-b"), Some(TaskStatus::Completed));
        assert_eq!(engine.snapshot().scene.revision, Revision(1));
    }
    #[test]
    fn spatial_graph_revision_appears_in_engine_snapshot() {
        let mut engine = Engine::new(instant());
        let root = FrameId::new("root").unwrap();
        let child = FrameId::new("child").unwrap();
        engine.register_root_frame(root.clone()).unwrap();
        engine
            .register_child_frame(
                child.clone(),
                root.clone(),
                FrameSample {
                    instant: instant(),
                    to_parent: RigidTransform::new(
                        Vec3d {
                            x: 5.0,
                            y: 0.0,
                            z: 0.0,
                        },
                        Quatd::IDENTITY,
                    )
                    .unwrap(),
                },
            )
            .unwrap();
        assert_eq!(engine.snapshot().frame_graph_revision, Revision(2));
        assert_eq!(engine.snapshot().sequence, 2);
        assert_eq!(
            engine
                .resolve_frame(&child, &root, &instant())
                .unwrap()
                .apply(Vec3d::ZERO)
                .x,
            5.0
        );
    }
    #[test]
    fn lifecycle_is_guarded() {
        let mut engine = Engine::new(instant());
        engine.start().unwrap();
        assert_eq!(engine.start(), Err(CoreError::InvalidState));
        engine.shutdown();
        assert_eq!(engine.state(), EngineState::Stopped);
        assert_eq!(engine.seek(instant()), Err(CoreError::AlreadyStopped));
    }
    #[test]
    fn time_commands_update_snapshot_once() {
        let mut engine = Engine::new(instant());
        engine.play().unwrap();
        engine.play().unwrap();
        assert_eq!(engine.snapshot().sequence, 1);
        engine.step_nanos(1_500_000_000).unwrap();
        assert_eq!(engine.snapshot().instant.seconds(), 1);
        assert_eq!(engine.snapshot().instant.nanos(), 500_000_000);
        assert_eq!(engine.snapshot().generation, TimeGeneration(0));
        engine.pause().unwrap();
        assert_eq!(engine.snapshot().sequence, 3);
    }
    #[test]
    fn command_and_snapshot_share_revision() {
        let mut engine = Engine::new(instant());
        let id = ObjectId::new("demo:earth").unwrap();
        engine
            .submit_scene(Revision(0), &[SceneCommand::Create(SceneObject::new(id))])
            .unwrap();
        let frame = engine.snapshot();
        assert_eq!(frame.scene.revision, Revision(1));
        assert_eq!(frame.sequence, 1);
        engine.seek(instant()).unwrap();
        assert_eq!(engine.snapshot().generation, TimeGeneration(1));
        assert_eq!(engine.snapshot().sequence, 2);
    }
    #[test]
    fn host_playback_respects_pause_sequence_and_shutdown() {
        let mut engine = Engine::new(instant());
        let before = engine.snapshot();
        engine.advance_nanos(1_000_000_000).unwrap();
        assert_eq!(engine.snapshot(), before);
        engine.start().unwrap();
        engine.play().unwrap();
        engine.advance_nanos(1_000_000_000).unwrap();
        assert_eq!(engine.snapshot().instant.seconds(), 1);
        assert_eq!(engine.snapshot().sequence, 2);
        assert_eq!(engine.snapshot().generation, TimeGeneration(0));
        let before = engine.snapshot();
        engine.advance_nanos(0).unwrap();
        assert_eq!(engine.snapshot(), before);
        engine.shutdown();
        let before = engine.snapshot();
        assert_eq!(engine.advance_nanos(1), Err(CoreError::AlreadyStopped));
        assert_eq!(engine.snapshot(), before);
    }
    #[test]
    fn host_playback_failure_is_atomic() {
        let mut engine =
            Engine::new(TimeInstant::new("TT", "epoch", i64::MAX, 999_999_999).unwrap());
        engine.play().unwrap();
        let before = engine.snapshot();
        assert_eq!(engine.advance_nanos(1), Err(CoreError::InvalidState));
        assert_eq!(engine.snapshot(), before);
        engine.seek(instant()).unwrap();
        engine.frame_sequence = u64::MAX;
        let before = engine.snapshot();
        let clock_before = engine.clock().snapshot();
        assert_eq!(engine.advance_nanos(1), Err(CoreError::InvalidState));
        assert_eq!(engine.snapshot(), before);
        assert_eq!(engine.clock().snapshot(), clock_before);
    }
    #[test]
    fn host_playback_rejects_old_result_commit_without_scene_changes() {
        let mut engine = Engine::new(instant());
        engine
            .enqueue_task(TaskRequest {
                task_id: "playback".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
                dependencies: vec![],
            })
            .unwrap();
        engine.start_task("playback").unwrap();
        engine
            .accept_task_result(&TaskResult {
                task_id: "playback".into(),
                generation: TimeGeneration(0),
                requested_instant: instant(),
            })
            .unwrap();
        engine.play().unwrap();
        engine.advance_nanos(1).unwrap();
        assert_eq!(
            engine.commit_task_scene(
                "playback",
                Revision(0),
                &[SceneCommand::Create(SceneObject::new(
                    ObjectId::new("stale").unwrap()
                )),]
            ),
            Err(CommitTaskError::Task(TaskError::WrongInstant))
        );
        assert!(engine.scene().is_empty());
        assert_eq!(engine.snapshot().generation, TimeGeneration(0));
    }
}
