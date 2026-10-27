//! Platform-neutral task execution contract and bounded dispatch policy.
//! Native and WASM hosts may execute issued tasks differently.
use crate::{SimulationScheduler, TaskError, TaskRequest, TaskStatus};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskBudget {
    pub max_in_flight: usize,
    pub max_queued: usize,
}
impl TaskBudget {
    pub fn new(max_in_flight: usize, max_queued: usize) -> Result<Self, TaskError> {
        if max_in_flight == 0 || max_queued == 0 {
            return Err(TaskError::InvalidBudget);
        }
        Ok(Self { max_in_flight, max_queued })
    }
}

/// A host schedules this request on its own executor; this method does not
/// perform work or mutate Scene. A future async adapter can use the same contract.
pub trait TaskExecutor {
    fn dispatch(&mut self, task: TaskRequest) -> Result<(), TaskError>;
    /// Best-effort host notification; the scheduler rejects late results regardless.
    fn request_cancel(&mut self, _task_id: &str) -> Result<(), TaskError> { Ok(()) }
}

/// Issues ready tasks in stable order up to available in-flight slots.
/// A dispatch failure marks the task Failed; it is never silently re-dispatched.
pub fn dispatch_ready(
    scheduler: &mut SimulationScheduler,
    budget: TaskBudget,
    executor: &mut impl TaskExecutor,
) -> Result<Vec<String>, TaskError> {
    let active = scheduler.active_count();
    let slots = budget.max_in_flight.saturating_sub(active);
    let mut dispatched = Vec::new();
    for id in scheduler.ready_tasks().into_iter().take(slots) {
        let request = scheduler.request(&id).ok_or(TaskError::UnknownTask)?.clone();
        scheduler.start(&id)?;
        if let Err(error) = executor.dispatch(request) {
            scheduler.fail(&id)?;
            return Err(error);
        }
        dispatched.push(id);
    }
    Ok(dispatched)
}

pub fn enqueue_bounded(
    scheduler: &mut SimulationScheduler,
    budget: TaskBudget,
    request: TaskRequest,
) -> Result<(), TaskError> {
    if scheduler.queued_count() >= budget.max_queued {
        return Err(TaskError::QueueFull);
    }
    scheduler.enqueue(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_time::{TimeGeneration, TimeInstant};

    #[derive(Default)]
    struct Recorder(Vec<String>);
    impl TaskExecutor for Recorder {
        fn dispatch(&mut self, task: TaskRequest) -> Result<(), TaskError> {
            self.0.push(task.task_id);
            Ok(())
        }
    }
    fn task(id: &str) -> TaskRequest {
        TaskRequest {
            task_id: id.into(),
            generation: TimeGeneration(0),
            requested_instant: TimeInstant::new("TT", "epoch", 0, 0).unwrap(),
            dependencies: vec![],
        }
    }
    #[test]
    fn bounded_dispatch_respects_capacity() {
        let mut scheduler = SimulationScheduler::new();
        let budget = TaskBudget::new(1, 2).unwrap();
        enqueue_bounded(&mut scheduler, budget, task("b")).unwrap();
        enqueue_bounded(&mut scheduler, budget, task("a")).unwrap();
        assert_eq!(enqueue_bounded(&mut scheduler, budget, task("c")), Err(TaskError::QueueFull));
        let mut executor = Recorder::default();
        assert_eq!(dispatch_ready(&mut scheduler, budget, &mut executor).unwrap(), vec!["a"]);
        assert_eq!(dispatch_ready(&mut scheduler, budget, &mut executor).unwrap(), Vec::<String>::new());
        assert_eq!(scheduler.status("a"), Some(TaskStatus::Running));
    }
}
