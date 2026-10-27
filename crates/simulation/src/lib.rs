//! Generic simulation task admission and result freshness checks.
//! Does not calculate ephemerides or mutate Scene.
use std::collections::HashMap;
use spaceeyes_time::{TimeGeneration, TimeInstant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskError {
    EmptyTaskId,
    DuplicateTask,
    UnknownTask,
    StaleGeneration,
    WrongInstant,
    AlreadyCompleted,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskRequest {
    pub task_id: String,
    pub generation: TimeGeneration,
    pub requested_instant: TimeInstant,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskResult {
    pub task_id: String,
    pub generation: TimeGeneration,
    pub requested_instant: TimeInstant,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus { Queued, Completed, Stale }
#[derive(Default)]
pub struct SimulationScheduler {
    tasks: HashMap<String, (TaskRequest, TaskStatus)>,
}
impl SimulationScheduler {
    pub fn new() -> Self { Self::default() }
    pub fn enqueue(&mut self, request: TaskRequest) -> Result<(), TaskError> {
        if request.task_id.trim().is_empty() { return Err(TaskError::EmptyTaskId); }
        if self.tasks.contains_key(&request.task_id) { return Err(TaskError::DuplicateTask); }
        self.tasks.insert(request.task_id.clone(), (request, TaskStatus::Queued));
        Ok(())
    }
    /// Validate a completed calculation against both generation and target instant.
    /// This is a pre-commit check, not a Scene write.
    pub fn accept_result(
        &mut self,
        result: &TaskResult,
        generation: TimeGeneration,
        instant: &TimeInstant,
    ) -> Result<(), TaskError> {
        let (request, status) = self.tasks.get_mut(&result.task_id).ok_or(TaskError::UnknownTask)?;
        if *status != TaskStatus::Queued { return Err(TaskError::AlreadyCompleted); }
        if request.generation != generation || result.generation != generation {
            *status = TaskStatus::Stale;
            return Err(TaskError::StaleGeneration);
        }
        if &request.requested_instant != instant || &result.requested_instant != instant {
            *status = TaskStatus::Stale;
            return Err(TaskError::WrongInstant);
        }
        *status = TaskStatus::Completed;
        Ok(())
    }
    pub fn status(&self, id: &str) -> Option<TaskStatus> {
        self.tasks.get(id).map(|(_, status)| *status)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn instant(seconds: i64) -> TimeInstant {
        TimeInstant::new("TT", "epoch", seconds, 0).unwrap()
    }
    #[test]
    fn stale_generation_is_rejected() {
        let mut scheduler = SimulationScheduler::new();
        scheduler.enqueue(TaskRequest { task_id:"a".into(), generation:TimeGeneration(0), requested_instant:instant(0) }).unwrap();
        let result = TaskResult { task_id:"a".into(), generation:TimeGeneration(0), requested_instant:instant(0) };
        assert_eq!(scheduler.accept_result(&result, TimeGeneration(1), &instant(0)), Err(TaskError::StaleGeneration));
        assert_eq!(scheduler.status("a"), Some(TaskStatus::Stale));
    }
    #[test]
    fn same_generation_wrong_instant_is_rejected() {
        let mut scheduler = SimulationScheduler::new();
        scheduler.enqueue(TaskRequest { task_id:"a".into(), generation:TimeGeneration(0), requested_instant:instant(0) }).unwrap();
        let result = TaskResult { task_id:"a".into(), generation:TimeGeneration(0), requested_instant:instant(0) };
        assert_eq!(scheduler.accept_result(&result, TimeGeneration(0), &instant(1)), Err(TaskError::WrongInstant));
    }
}
