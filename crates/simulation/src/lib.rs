// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Deterministic task dependency, cancellation, and pre-commit coordination.
//! No domain algorithm or direct Scene mutation lives here.
use spaceeyes_foundation::Revision;
use spaceeyes_time::{TimeGeneration, TimeInstant};
use std::collections::{BTreeMap, BTreeSet};
mod executor;
pub use executor::{dispatch_ready, enqueue_bounded, TaskBudget, TaskExecutor};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskError {
    EmptyTaskId,
    DuplicateTask,
    UnknownTask,
    MissingDependency,
    DependencyCycle,
    DependencyNotReady,
    DependencyFailed,
    StaleGeneration,
    WrongInstant,
    AlreadyCompleted,
    InvalidState,
    InvalidBudget,
    QueueFull,
    InFlightFull,
    InvalidProvenance,
    RevisionMismatch,
    CoverageMismatch,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskRequest {
    pub task_id: String,
    pub generation: TimeGeneration,
    pub requested_instant: TimeInstant,
    pub dependencies: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskResult {
    pub task_id: String,
    pub generation: TimeGeneration,
    pub requested_instant: TimeInstant,
}
/// Optional provenance contract for tasks requiring strict scientific context.
/// Coverage is an inclusive range in one explicit time scale and epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskProvenance {
    pub scene_revision: Revision,
    pub frame_graph_revision: Revision,
    pub provider_id: String,
    pub provider_version: String,
    pub coverage_start: TimeInstant,
    pub coverage_end: TimeInstant,
}
impl TaskProvenance {
    pub fn validate(&self, instant: &TimeInstant) -> Result<(), TaskError> {
        if self.provider_id.trim().is_empty() || self.provider_version.trim().is_empty() {
            return Err(TaskError::InvalidProvenance);
        }
        if self.coverage_start.scale() != self.coverage_end.scale()
            || self.coverage_start.epoch() != self.coverage_end.epoch()
            || instant.scale() != self.coverage_start.scale()
            || instant.epoch() != self.coverage_start.epoch()
        {
            return Err(TaskError::CoverageMismatch);
        }
        let start = (self.coverage_start.seconds(), self.coverage_start.nanos());
        let end = (self.coverage_end.seconds(), self.coverage_end.nanos());
        let target = (instant.seconds(), instant.nanos());
        if start > end || target < start || target > end {
            return Err(TaskError::CoverageMismatch);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Queued,
    Running,
    ResultReady,
    Completed,
    Cancelled,
    Failed,
    Stale,
}
impl TaskStatus {
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Cancelled | Self::Failed | Self::Stale
        )
    }
}
#[derive(Clone, Debug)]
struct TaskEntry {
    request: TaskRequest,
    status: TaskStatus,
    provenance: Option<TaskProvenance>,
}
#[derive(Default)]
pub struct SimulationScheduler {
    tasks: BTreeMap<String, TaskEntry>,
}
impl SimulationScheduler {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn enqueue(&mut self, request: TaskRequest) -> Result<(), TaskError> {
        if request.task_id.trim().is_empty() {
            return Err(TaskError::EmptyTaskId);
        }
        if self.tasks.contains_key(&request.task_id) {
            return Err(TaskError::DuplicateTask);
        }
        let mut unique = BTreeSet::new();
        for dependency in &request.dependencies {
            if dependency == &request.task_id {
                return Err(TaskError::DependencyCycle);
            }
            if !unique.insert(dependency) {
                return Err(TaskError::DuplicateTask);
            }
            if !self.tasks.contains_key(dependency) {
                return Err(TaskError::MissingDependency);
            }
        }
        // Dependencies must already exist, so insertion cannot create a cycle.
        self.tasks.insert(
            request.task_id.clone(),
            TaskEntry {
                request,
                status: TaskStatus::Queued,
                provenance: None,
            },
        );
        Ok(())
    }
    /// Bind provenance before dispatch; it becomes immutable for this task.
    pub fn bind_provenance(
        &mut self,
        id: &str,
        provenance: TaskProvenance,
    ) -> Result<(), TaskError> {
        let entry = self.tasks.get_mut(id).ok_or(TaskError::UnknownTask)?;
        if entry.status != TaskStatus::Queued || entry.provenance.is_some() {
            return Err(TaskError::InvalidState);
        }
        provenance.validate(&entry.request.requested_instant)?;
        entry.provenance = Some(provenance);
        Ok(())
    }
    pub fn validate_provenance(
        &self,
        id: &str,
        scene: Revision,
        frames: Revision,
    ) -> Result<(), TaskError> {
        let entry = self.tasks.get(id).ok_or(TaskError::UnknownTask)?;
        if let Some(provenance) = &entry.provenance {
            provenance.validate(&entry.request.requested_instant)?;
            if provenance.scene_revision != scene || provenance.frame_graph_revision != frames {
                return Err(TaskError::RevisionMismatch);
            }
        }
        Ok(())
    }
    pub fn request(&self, id: &str) -> Option<&TaskRequest> {
        self.tasks.get(id).map(|entry| &entry.request)
    }
    pub fn queued_count(&self) -> usize {
        self.tasks
            .values()
            .filter(|entry| entry.status == TaskStatus::Queued)
            .count()
    }
    pub fn active_count(&self) -> usize {
        self.tasks
            .values()
            .filter(|entry| matches!(entry.status, TaskStatus::Running | TaskStatus::ResultReady))
            .count()
    }
    /// Verify freshness immediately before the Engine's authoritative Scene commit.
    pub fn validate_commit(
        &self,
        id: &str,
        generation: TimeGeneration,
        instant: &TimeInstant,
    ) -> Result<(), TaskError> {
        let entry = self.tasks.get(id).ok_or(TaskError::UnknownTask)?;
        if entry.status != TaskStatus::ResultReady {
            return Err(TaskError::InvalidState);
        }
        if entry.request.generation != generation {
            return Err(TaskError::StaleGeneration);
        }
        if &entry.request.requested_instant != instant {
            return Err(TaskError::WrongInstant);
        }
        if let Some(provenance) = &entry.provenance {
            provenance.validate(instant)?;
        }
        Ok(())
    }
    pub fn status(&self, id: &str) -> Option<TaskStatus> {
        self.tasks.get(id).map(|entry| entry.status)
    }
    /// Stable lexical order, independent of HashMap iteration or executor completion.
    pub fn ready_tasks(&self) -> Vec<String> {
        self.tasks
            .iter()
            .filter_map(|(id, entry)| {
                if entry.status != TaskStatus::Queued {
                    return None;
                }
                let all_done = entry
                    .request
                    .dependencies
                    .iter()
                    .all(|dependency| self.status(dependency) == Some(TaskStatus::Completed));
                if all_done {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect()
    }
    pub fn start(&mut self, id: &str) -> Result<(), TaskError> {
        let entry = self.tasks.get(id).ok_or(TaskError::UnknownTask)?;
        if entry.status != TaskStatus::Queued {
            return Err(TaskError::InvalidState);
        }
        for dependency in &entry.request.dependencies {
            match self.status(dependency) {
                Some(TaskStatus::Completed) => {}
                Some(TaskStatus::Cancelled | TaskStatus::Failed | TaskStatus::Stale) => {
                    return Err(TaskError::DependencyFailed)
                }
                _ => return Err(TaskError::DependencyNotReady),
            }
        }
        self.tasks.get_mut(id).expect("checked above").status = TaskStatus::Running;
        Ok(())
    }
    /// Validate a result, but do not claim completion before Engine commits.
    pub fn accept_result(
        &mut self,
        result: &TaskResult,
        generation: TimeGeneration,
        instant: &TimeInstant,
    ) -> Result<(), TaskError> {
        let entry = self
            .tasks
            .get_mut(&result.task_id)
            .ok_or(TaskError::UnknownTask)?;
        if entry.status != TaskStatus::Running {
            return Err(TaskError::InvalidState);
        }
        if entry.request.generation != generation || result.generation != generation {
            entry.status = TaskStatus::Stale;
            self.propagate_dependency_failures();
            return Err(TaskError::StaleGeneration);
        }
        if &entry.request.requested_instant != instant || &result.requested_instant != instant {
            entry.status = TaskStatus::Stale;
            self.propagate_dependency_failures();
            return Err(TaskError::WrongInstant);
        }
        entry.status = TaskStatus::ResultReady;
        Ok(())
    }
    /// Engine calls this only after the corresponding Scene transaction succeeds.
    pub fn complete(&mut self, id: &str) -> Result<(), TaskError> {
        let entry = self.tasks.get_mut(id).ok_or(TaskError::UnknownTask)?;
        if entry.status != TaskStatus::ResultReady {
            return Err(TaskError::InvalidState);
        }
        entry.status = TaskStatus::Completed;
        Ok(())
    }
    pub fn cancel(&mut self, id: &str) -> Result<(), TaskError> {
        let entry = self.tasks.get_mut(id).ok_or(TaskError::UnknownTask)?;
        if entry.status.terminal() {
            return Err(TaskError::AlreadyCompleted);
        }
        entry.status = TaskStatus::Cancelled;
        self.propagate_dependency_failures();
        Ok(())
    }
    pub fn fail(&mut self, id: &str) -> Result<(), TaskError> {
        let entry = self.tasks.get_mut(id).ok_or(TaskError::UnknownTask)?;
        if entry.status.terminal() {
            return Err(TaskError::AlreadyCompleted);
        }
        entry.status = TaskStatus::Failed;
        self.propagate_dependency_failures();
        Ok(())
    }
    fn propagate_dependency_failures(&mut self) {
        loop {
            let blocked: Vec<_> = self
                .tasks
                .iter()
                .filter_map(|(id, entry)| {
                    if entry.status == TaskStatus::Queued
                        && entry.request.dependencies.iter().any(|dep| {
                            matches!(
                                self.status(dep),
                                Some(
                                    TaskStatus::Failed | TaskStatus::Cancelled | TaskStatus::Stale
                                )
                            )
                        })
                    {
                        Some(id.clone())
                    } else {
                        None
                    }
                })
                .collect();
            if blocked.is_empty() {
                break;
            }
            for id in blocked {
                self.tasks.get_mut(&id).expect("known task").status = TaskStatus::Failed;
            }
        }
    }
    /// Remove completed history only when no live task still depends on it.
    pub fn forget_terminal(&mut self, id: &str) -> Result<(), TaskError> {
        if !self
            .tasks
            .get(id)
            .ok_or(TaskError::UnknownTask)?
            .status
            .terminal()
        {
            return Err(TaskError::InvalidState);
        }
        if self
            .tasks
            .values()
            .any(|e| !e.status.terminal() && e.request.dependencies.iter().any(|d| d == id))
        {
            return Err(TaskError::DependencyNotReady);
        }
        self.tasks.remove(id);
        Ok(())
    }
    /// On seek, invalidate nonterminal tasks; late results can no longer commit.
    pub fn invalidate_generation(&mut self, generation: TimeGeneration) {
        for entry in self.tasks.values_mut() {
            if !entry.status.terminal() && entry.request.generation != generation {
                entry.status = TaskStatus::Stale;
            }
        }
        self.propagate_dependency_failures();
    }
    pub fn cancel_all(&mut self) {
        for entry in self.tasks.values_mut() {
            if !entry.status.terminal() {
                entry.status = TaskStatus::Cancelled;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn instant(s: i64) -> TimeInstant {
        TimeInstant::new("TT", "epoch", s, 0).unwrap()
    }
    fn task(id: &str, deps: &[&str]) -> TaskRequest {
        TaskRequest {
            task_id: id.into(),
            generation: TimeGeneration(0),
            requested_instant: instant(0),
            dependencies: deps.iter().map(|s| s.to_string()).collect(),
        }
    }
    fn result(id: &str) -> TaskResult {
        TaskResult {
            task_id: id.into(),
            generation: TimeGeneration(0),
            requested_instant: instant(0),
        }
    }
    #[test]
    fn provenance_rejects_wrong_coverage_and_revision() {
        let mut s = SimulationScheduler::new();
        s.enqueue(task("a", &[])).unwrap();
        let p = TaskProvenance {
            scene_revision: Revision(2),
            frame_graph_revision: Revision(3),
            provider_id: "provider".into(),
            provider_version: "1".into(),
            coverage_start: instant(0),
            coverage_end: instant(1),
        };
        s.bind_provenance("a", p).unwrap();
        assert_eq!(
            s.validate_provenance("a", Revision(2), Revision(4)),
            Err(TaskError::RevisionMismatch)
        );
        assert_eq!(s.validate_provenance("a", Revision(2), Revision(3)), Ok(()));
    }
    #[test]
    fn dependency_order_and_commit_gate() {
        let mut s = SimulationScheduler::new();
        s.enqueue(task("a", &[])).unwrap();
        s.enqueue(task("b", &["a"])).unwrap();
        assert_eq!(s.ready_tasks(), vec!["a"]);
        assert_eq!(s.start("b"), Err(TaskError::DependencyNotReady));
        s.start("a").unwrap();
        s.accept_result(&result("a"), TimeGeneration(0), &instant(0))
            .unwrap();
        assert!(s.ready_tasks().is_empty());
        s.complete("a").unwrap();
        assert_eq!(s.ready_tasks(), vec!["b"]);
    }
    #[test]
    fn missing_and_self_dependency_rejected() {
        let mut s = SimulationScheduler::new();
        assert_eq!(
            s.enqueue(task("a", &["missing"])),
            Err(TaskError::MissingDependency)
        );
        assert_eq!(
            s.enqueue(task("a", &["a"])),
            Err(TaskError::DependencyCycle)
        );
    }
    #[test]
    fn stale_and_cancelled_results_cannot_commit() {
        let mut s = SimulationScheduler::new();
        s.enqueue(task("a", &[])).unwrap();
        s.start("a").unwrap();
        s.invalidate_generation(TimeGeneration(1));
        assert_eq!(s.status("a"), Some(TaskStatus::Stale));
        assert_eq!(
            s.accept_result(&result("a"), TimeGeneration(1), &instant(0)),
            Err(TaskError::InvalidState)
        );
        s.enqueue(task("b", &[])).unwrap();
        s.cancel("b").unwrap();
        assert_eq!(s.start("b"), Err(TaskError::InvalidState));
    }
    #[test]
    fn same_generation_wrong_instant_rejected() {
        let mut s = SimulationScheduler::new();
        s.enqueue(task("a", &[])).unwrap();
        s.start("a").unwrap();
        assert_eq!(
            s.accept_result(&result("a"), TimeGeneration(0), &instant(1)),
            Err(TaskError::WrongInstant)
        );
    }
    #[test]
    fn cancellation_blocks_dependents() {
        let mut s = SimulationScheduler::new();
        s.enqueue(task("a", &[])).unwrap();
        s.enqueue(task("b", &["a"])).unwrap();
        s.cancel("a").unwrap();
        assert_eq!(s.status("b"), Some(TaskStatus::Failed));
        assert_eq!(s.start("b"), Err(TaskError::InvalidState));
    }
}
