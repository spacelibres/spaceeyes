// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use super::*;

fn request(id: &str) -> TaskRequest {
    TaskRequest {
        task_id: id.into(),
        generation: TimeGeneration(0),
        requested_instant: TimeInstant::new("TT", "epoch", 0, 0).unwrap(),
        dependencies: vec![],
    }
}

#[test]
fn forgotten_id_and_clear_never_reuse_execution_identity() {
    let mut scheduler = SimulationScheduler::new();
    scheduler.enqueue(request("same")).unwrap();
    let old = scheduler.issued_task("same").unwrap();
    scheduler.cancel("same").unwrap();
    scheduler.forget_terminal("same").unwrap();
    scheduler.enqueue(request("same")).unwrap();
    let current = scheduler.issued_task("same").unwrap();
    assert_ne!(old.token, current.token);
    scheduler.start("same").unwrap();
    let stale = TaskResult::from(&old);
    assert_eq!(
        scheduler.accept_result(&stale, TimeGeneration(0), &old.request.requested_instant),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(
        scheduler.fail_execution("same", &old.token),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(
        scheduler.cancel_execution("same", &old.token),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(scheduler.status("same"), Some(TaskStatus::Running));
    scheduler.clear();
    scheduler.enqueue(request("same")).unwrap();
    let fresh = scheduler.issued_task("same").unwrap();
    assert_ne!(fresh.token, current.token);
    assert!(fresh.token.sequence > current.token.sequence);
}

#[test]
fn sequence_exhaustion_is_atomic_and_clear_cannot_reset_it() {
    let mut scheduler = SimulationScheduler::new();
    scheduler.sequence = u64::MAX - 1;
    scheduler.enqueue(request("last")).unwrap();
    let last = scheduler.issued_task("last").unwrap();
    assert_eq!(last.token.sequence, u64::MAX);
    assert_eq!(
        scheduler.enqueue(request("overflow")),
        Err(TaskError::SequenceExhausted)
    );
    assert!(scheduler.issued_task("overflow").is_none());
    assert_eq!(scheduler.status("last"), Some(TaskStatus::Queued));
    scheduler.clear();
    assert_eq!(
        scheduler.enqueue(request("last")),
        Err(TaskError::SequenceExhausted)
    );
}

#[test]
fn foreign_feedback_does_not_fail_dependencies_or_change_ready_result() {
    let mut first = SimulationScheduler::new();
    let mut second = SimulationScheduler::new();
    first.enqueue(request("same")).unwrap();
    second.enqueue(request("same")).unwrap();
    let mut dependent = request("dependent");
    dependent.dependencies.push("same".into());
    second.enqueue(dependent).unwrap();
    second.start("same").unwrap();
    let local = second.issued_task("same").unwrap();
    second
        .accept_result(
            &TaskResult::from(&local),
            TimeGeneration(0),
            &local.request.requested_instant,
        )
        .unwrap();
    let foreign = first.issued_task("same").unwrap().token;
    assert_eq!(
        second.complete("same", &foreign),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(
        second.fail_execution("same", &foreign),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(
        second.cancel_execution("same", &foreign),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(
        second.validate_commit(
            "same",
            &foreign,
            TimeGeneration(0),
            &local.request.requested_instant
        ),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(second.status("same"), Some(TaskStatus::ResultReady));
    assert_eq!(second.status("dependent"), Some(TaskStatus::Queued));
    second.complete("same", &local.token).unwrap();
    assert_eq!(second.ready_tasks(), vec!["dependent"]);
}

#[test]
fn executors_receive_issued_identity_for_dispatch_and_cancel_contract() {
    #[derive(Default)]
    struct Recorder(Vec<IssuedTask>);
    impl TaskExecutor for Recorder {
        fn dispatch(&mut self, task: IssuedTask) -> Result<(), TaskError> {
            self.0.push(task);
            Ok(())
        }
    }
    let mut scheduler = SimulationScheduler::new();
    scheduler.enqueue(request("same")).unwrap();
    let expected = scheduler.issued_task("same").unwrap();
    let mut executor = Recorder::default();
    dispatch_ready(
        &mut scheduler,
        TaskBudget::new(1, 1).unwrap(),
        &mut executor,
    )
    .unwrap();
    assert_eq!(executor.0, vec![expected]);
}
