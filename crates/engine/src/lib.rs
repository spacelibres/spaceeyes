//! Engine owns session lifecycle, scene command entry, and consistent read snapshots.
use std::collections::BTreeMap;
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::{Scene, SceneCommand, SceneSnapshot};
use spaceeyes_spatial::{ReferenceFrameGraph, SpatialError, FrameSample, RigidTransform, ProviderRef};
use spaceeyes_foundation::FrameId;
use spaceeyes_time::{SimulationClock, TimeGeneration, TimeInstant};
use spaceeyes_resources::{ResourceManager, ResourceBudget, ResourceError};
use spaceeyes_foundation::ResourceId;
use spaceeyes_simulation::{SimulationScheduler, TaskRequest, TaskResult, TaskStatus, TaskError, TaskBudget, TaskExecutor, dispatch_ready, enqueue_bounded};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EngineState { Ready, Running, Stopped }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineSnapshot {
    pub scene: SceneSnapshot,
    pub instant: TimeInstant,
    pub generation: TimeGeneration,
    pub sequence: u64,
    pub frame_graph_revision: Revision,
    pub resource_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitTaskError { EngineStopped, Task(TaskError), Scene(CoreError) }

pub struct Engine {
    state: EngineState,
    scene: Scene,
    clock: SimulationClock,
    spatial: ReferenceFrameGraph,
    simulation: SimulationScheduler,
    task_budget: TaskBudget,
    resources: ResourceManager,
    task_leases: BTreeMap<String, Vec<ResourceId>>,
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
            resources: ResourceManager::new(ResourceBudget { max_bytes: 256 * 1024 * 1024 }),
            task_leases: BTreeMap::new(),
            frame_sequence: 0,
        }
    }
    pub fn state(&self) -> EngineState { self.state }
    pub fn scene(&self) -> &Scene { &self.scene }
    pub fn clock(&self) -> &SimulationClock { &self.clock }
    pub fn spatial(&self) -> &ReferenceFrameGraph { &self.spatial }
    pub fn resource_used_bytes(&self) -> u64 { self.resources.used_bytes() }
    pub fn task_status(&self, id: &str) -> Option<TaskStatus> { self.simulation.status(id) }
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
    pub fn start(&mut self) -> Result<(), CoreError> {
        if self.state != EngineState::Ready { return Err(CoreError::InvalidState); }
        self.state = EngineState::Running;
        Ok(())
    }
    /// The only Engine-facing scene write path. A future protocol adapter will call this.
    pub fn submit_scene(
        &mut self,
        expected_revision: Revision,
        commands: &[SceneCommand],
    ) -> Result<Revision, CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let previous = self.scene.revision();
        let next = self.scene.apply_transaction(expected_revision, commands)?;
        if next != previous { self.frame_sequence += 1; }
        Ok(next)
    }
    pub fn seek(&mut self, instant: TimeInstant) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        self.clock.seek(instant)?;
        self.simulation.invalidate_generation(self.clock.generation());
        self.release_terminal_task_leases();
        self.frame_sequence += 1;
        Ok(())
    }
    pub fn play(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.play()?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    pub fn pause(&mut self) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.pause()?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    pub fn step_nanos(&mut self, delta: i128) -> Result<(), CoreError> {
        if self.state == EngineState::Stopped { return Err(CoreError::AlreadyStopped); }
        let before = self.clock.snapshot().revision;
        self.clock.step_nanos(delta)?;
        if self.clock.snapshot().revision != before { self.frame_sequence += 1; }
        Ok(())
    }
    pub fn register_resource(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped { return Err(ResourceError::EngineUnavailable); }
        self.resources.register(id, bytes)?;
        self.frame_sequence += 1;
        Ok(())
    }
    pub fn lease_resource(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped { return Err(ResourceError::EngineUnavailable); }
        self.resources.lease(id)
    }
    pub fn release_resource_lease(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        self.resources.release_lease(id)
    }
    pub fn unregister_resource(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped { return Err(ResourceError::EngineUnavailable); }
        self.resources.unregister(id)?;
        self.frame_sequence += 1;
        Ok(())
    }
    /// Register a task for the current authoritative time generation.
    pub fn enqueue_task(&mut self, request: TaskRequest) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped { return Err(TaskError::InvalidState); }
        if request.generation != self.clock.generation() { return Err(TaskError::StaleGeneration); }
        enqueue_bounded(&mut self.simulation, self.task_budget, request)
    }
    pub fn ready_tasks(&self) -> Vec<String> { self.simulation.ready_tasks() }
    /// A host-provided executor handles actual work; Engine only issues ready tasks.
    pub fn dispatch_tasks(&mut self, executor: &mut impl TaskExecutor) -> Result<Vec<String>, TaskError> {
        if self.state == EngineState::Stopped { return Err(TaskError::InvalidState); }
        let result = dispatch_ready(&mut self.simulation, self.task_budget, executor);
        self.release_terminal_task_leases();
        result
    }
    pub fn start_task(&mut self, id: &str) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped { return Err(TaskError::InvalidState); }
        self.simulation.start(id)
    }
    pub fn cancel_task(&mut self, id: &str) -> Result<(), TaskError> {
        self.simulation.cancel(id)?;
        self.release_task_leases(id);
        Ok(())
    }
    pub fn fail_task(&mut self, id: &str) -> Result<(), TaskError> {
        self.simulation.fail(id)?;
        self.release_task_leases(id);
        Ok(())
    }
    /// Attach a logical resource lease to an existing nonterminal task.
    /// The task's lease is owned by Engine, not by the executor or Scene.
    pub fn attach_task_resource(&mut self, task_id: &str, id: &ResourceId) -> Result<(), ResourceError> {
        if self.state == EngineState::Stopped { return Err(ResourceError::EngineUnavailable); }
        match self.simulation.status(task_id) {
            Some(TaskStatus::Queued | TaskStatus::Running | TaskStatus::ResultReady) => {},
            _ => return Err(ResourceError::InvalidLease),
        }
        self.resources.lease(id)?;
        self.task_leases.entry(task_id.to_owned()).or_default().push(id.clone());
        Ok(())
    }
    fn release_task_leases(&mut self, task_id: &str) {
        if let Some(resources) = self.task_leases.remove(task_id) {
            for id in resources {
                // Engine is the only owner of these specific acquired leases.
                self.resources.release_lease(&id).expect("task lease invariant");
            }
        }
    }
    fn release_terminal_task_leases(&mut self) {
        let ids: Vec<String> = self.task_leases.keys()
            .filter(|id| matches!(self.simulation.status(id), Some(TaskStatus::Completed | TaskStatus::Cancelled | TaskStatus::Failed | TaskStatus::Stale)))
            .cloned().collect();
        for id in ids { self.release_task_leases(&id); }
    }
    /// Result acceptance does not mutate Scene or claim a completed transaction.
    pub fn accept_task_result(&mut self, result: &TaskResult) -> Result<(), TaskError> {
        if self.state == EngineState::Stopped { return Err(TaskError::InvalidState); }
        self.simulation.accept_result(result, self.clock.generation(), self.clock.instant())
    }
    /// Commit a validated result through the sole Scene transaction path.
    /// A failed Scene transaction leaves the task ResultReady for explicit retry/cancel.
    pub fn commit_task_scene(
        &mut self, task_id: &str, expected_revision: Revision, commands: &[SceneCommand],
    ) -> Result<Revision, CommitTaskError> {
        if self.state == EngineState::Stopped { return Err(CommitTaskError::EngineStopped); }
        self.simulation.validate_commit(task_id, self.clock.generation(), self.clock.instant())
            .map_err(CommitTaskError::Task)?;
        let revision = self.submit_scene(expected_revision, commands).map_err(CommitTaskError::Scene)?;
        self.simulation.complete(task_id).map_err(CommitTaskError::Task)?;
        self.release_task_leases(task_id);
        Ok(revision)
    }
    /// All spatial graph writes pass through Engine, never through plugins.
    pub fn register_root_frame(&mut self, id: FrameId) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next_sequence = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_root(id)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn register_child_frame(&mut self, id: FrameId, parent: FrameId, sample: FrameSample) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next_sequence = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_child(id, parent, sample)?;
        self.frame_sequence = next_sequence;
        Ok(revision)
    }
    pub fn register_dynamic_frame(
        &mut self, id: FrameId, parent: FrameId, provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.register_dynamic_child(id, parent, provider)?;
        self.frame_sequence = next;
        Ok(revision)
    }
    pub fn replace_frame_provider(
        &mut self, id: &FrameId, provider: ProviderRef,
    ) -> Result<Revision, SpatialError> {
        if self.state == EngineState::Stopped { return Err(SpatialError::EngineUnavailable); }
        let next = self.frame_sequence.checked_add(1).ok_or(SpatialError::RevisionOverflow)?;
        let revision = self.spatial.replace_provider(id, provider)?;
        self.frame_sequence = next;
        Ok(revision)
    }
    pub fn resolve_frame(&self, source: &FrameId, target: &FrameId, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        self.spatial.resolve(source, target, instant)
    }
    pub fn shutdown(&mut self) {
        self.simulation.cancel_all();
        self.release_terminal_task_leases();
        self.state = EngineState::Stopped;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_foundation::ObjectId;
    use spaceeyes_scene::SceneObject;
    use spaceeyes_spatial::{Vec3d, Quatd};

    fn instant() -> TimeInstant {
        TimeInstant::new("TT", "UNSPECIFIED_EPOCH", 0, 0).unwrap()
    }
    #[test]
    fn task_leases_release_on_cancel_seek_and_commit() {
        let mut engine = Engine::new(instant());
        let resource = ResourceId::new("data:sample").unwrap();
        engine.register_resource(resource.clone(), 10).unwrap();
        for task_id in ["cancel", "seek", "commit"] {
            engine.enqueue_task(TaskRequest {
                task_id: task_id.into(), generation: engine.clock().generation(),
                requested_instant: engine.clock().instant().clone(), dependencies: vec![],
            }).unwrap();
            engine.attach_task_resource(task_id, &resource).unwrap();
        }
        assert_eq!(engine.unregister_resource(&resource), Err(ResourceError::StillLeased));
        engine.cancel_task("cancel").unwrap();
        engine.start_task("commit").unwrap();
        engine.accept_task_result(&TaskResult {
            task_id: "commit".into(), generation: engine.clock().generation(),
            requested_instant: engine.clock().instant().clone(),
        }).unwrap();
        engine.commit_task_scene("commit", Revision(0), &[]).unwrap();
        assert_eq!(engine.unregister_resource(&resource), Err(ResourceError::StillLeased));
        engine.seek(instant()).unwrap();
        engine.unregister_resource(&resource).unwrap();
    }
    #[test]
    fn stepping_time_blocks_result_commit_even_without_generation_change() {
        let mut engine = Engine::new(instant());
        engine.enqueue_task(TaskRequest {
            task_id: "step-task".into(), generation: TimeGeneration(0),
            requested_instant: instant(), dependencies: vec![],
        }).unwrap();
        engine.start_task("step-task").unwrap();
        engine.accept_task_result(&TaskResult {
            task_id: "step-task".into(), generation: TimeGeneration(0),
            requested_instant: instant(),
        }).unwrap();
        engine.step_nanos(1).unwrap();
        assert_eq!(
            engine.commit_task_scene("step-task", Revision(0), &[]),
            Err(CommitTaskError::Task(TaskError::WrongInstant))
        );
    }
    #[test]
    fn seek_invalidates_tasks_and_prevents_late_commit() {
        let mut engine = Engine::new(instant());
        engine.enqueue_task(TaskRequest {
            task_id: "task-a".into(), generation: TimeGeneration(0),
            requested_instant: instant(), dependencies: vec![],
        }).unwrap();
        engine.start_task("task-a").unwrap();
        engine.seek(instant()).unwrap();
        assert_eq!(engine.task_status("task-a"), Some(TaskStatus::Stale));
        assert_eq!(engine.commit_task_scene("task-a", Revision(0), &[]),
            Err(CommitTaskError::Task(TaskError::InvalidState)));
    }
    #[test]
    fn result_commits_only_through_scene_transaction() {
        let mut engine = Engine::new(instant());
        engine.enqueue_task(TaskRequest {
            task_id: "task-b".into(), generation: TimeGeneration(0),
            requested_instant: instant(), dependencies: vec![],
        }).unwrap();
        engine.start_task("task-b").unwrap();
        engine.accept_task_result(&TaskResult {
            task_id: "task-b".into(), generation: TimeGeneration(0), requested_instant: instant(),
        }).unwrap();
        let id = ObjectId::new("demo:moon").unwrap();
        assert_eq!(engine.commit_task_scene("task-b", Revision(9),
            &[SceneCommand::Create(SceneObject::new(id.clone()))]),
            Err(CommitTaskError::Scene(CoreError::RevisionConflict)));
        assert_eq!(engine.task_status("task-b"), Some(TaskStatus::ResultReady));
        engine.commit_task_scene("task-b", Revision(0),
            &[SceneCommand::Create(SceneObject::new(id))]).unwrap();
        assert_eq!(engine.task_status("task-b"), Some(TaskStatus::Completed));
        assert_eq!(engine.snapshot().scene.revision, Revision(1));
    }
    #[test]
    fn spatial_graph_revision_appears_in_engine_snapshot() {
        let mut engine = Engine::new(instant());
        let root = FrameId::new("root").unwrap();
        let child = FrameId::new("child").unwrap();
        engine.register_root_frame(root.clone()).unwrap();
        engine.register_child_frame(child.clone(), root.clone(), FrameSample {
            instant: instant(),
            to_parent: RigidTransform::new(Vec3d { x: 5.0, y: 0.0, z: 0.0 }, Quatd::IDENTITY).unwrap(),
        }).unwrap();
        assert_eq!(engine.snapshot().frame_graph_revision, Revision(2));
        assert_eq!(engine.snapshot().sequence, 2);
        assert_eq!(engine.resolve_frame(&child, &root, &instant()).unwrap().apply(Vec3d::ZERO).x, 5.0);
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
        engine.submit_scene(Revision(0), &[SceneCommand::Create(SceneObject::new(id))]).unwrap();
        let frame = engine.snapshot();
        assert_eq!(frame.scene.revision, Revision(1));
        assert_eq!(frame.sequence, 1);
        engine.seek(instant()).unwrap();
        assert_eq!(engine.snapshot().generation, TimeGeneration(1));
        assert_eq!(engine.snapshot().sequence, 2);
    }
}
