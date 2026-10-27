// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C06: native worker outcomes and strict provider-source policy.
use spaceeyes_engine::{CommitTaskError, Engine, ExecutorFeedback};
use spaceeyes_simulation::{
    ExecutionControl, IssuedTask, SourcePolicy, TaskError, TaskPriority, TaskProvenance,
    TaskRequest, TaskStatus, TaskWork, WorkerLimits, WorkerOutcome, WorkerPool,
};
use spaceeyes_time::{TimeGeneration, TimeInstant};
use std::sync::Arc;
use std::time::Duration;

fn instant() -> TimeInstant {
    TimeInstant::new("TT", "explicit", 0, 0).unwrap()
}

fn engine() -> Engine {
    Engine::new(instant())
}

fn request(id: &str) -> TaskRequest {
    TaskRequest {
        task_id: id.into(),
        generation: TimeGeneration(0),
        requested_instant: instant(),
        dependencies: vec![],
    }
}

fn provenance(version: &str) -> TaskProvenance {
    TaskProvenance {
        scene_revision: spaceeyes_foundation::Revision(0),
        frame_graph_revision: spaceeyes_foundation::Revision(0),
        provider_id: "nasa-dyn".into(),
        provider_version: version.into(),
        coverage_start: instant(),
        coverage_end: instant(),
    }
}

struct Immediate;
impl TaskWork for Immediate {
    fn work(&self, _task: &IssuedTask, control: &ExecutionControl) -> Result<(), TaskError> {
        control.check()
    }
}

#[test]
fn worker_outcome_flows_through_engine_feedback_to_commit() {
    let mut engine = engine();
    engine.enqueue_task(request("evaluate")).unwrap();
    let mut pool = WorkerPool::new(
        Arc::new(Immediate),
        WorkerLimits::new(1, 4, Duration::from_secs(1)).unwrap(),
    )
    .unwrap();
    assert_eq!(engine.dispatch_tasks(&mut pool).unwrap(), vec!["evaluate"]);
    let outcome = pool.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(matches!(outcome, WorkerOutcome::Completed(_)));
    engine.receive_executor_feedback(outcome.into()).unwrap();
    assert_eq!(
        engine.task_status("evaluate"),
        Some(TaskStatus::ResultReady)
    );
    let token = engine.issued_task("evaluate").unwrap().token;
    let revision = engine.scene().revision();
    engine
        .commit_task_scene("evaluate", &token, revision, &[])
        .unwrap();
    assert_eq!(engine.task_status("evaluate"), Some(TaskStatus::Completed));
}

#[test]
fn strict_source_policy_gates_binding_and_commit() {
    let mut engine = engine();
    engine.set_source_policy(SourcePolicy::strict([("nasa-dyn".into(), "1".into())]).unwrap());

    engine.enqueue_task(request("allowed")).unwrap();
    engine
        .bind_task_provenance("allowed", provenance("1"))
        .unwrap();
    engine.enqueue_task(request("denied")).unwrap();
    assert_eq!(
        engine.bind_task_provenance("denied", provenance("2")),
        Err(TaskError::SourceNotAllowed)
    );

    // A task without provenance cannot commit while a strict policy is active.
    engine.enqueue_task(request("bare")).unwrap();
    engine.start_task("bare").unwrap();
    let issued = engine.issued_task("bare").unwrap();
    engine
        .receive_executor_feedback(ExecutorFeedback::Result(
            spaceeyes_simulation::TaskResult::from(&issued),
        ))
        .unwrap();
    let revision = engine.scene().revision();
    assert_eq!(
        engine.commit_task_scene("bare", &issued.token, revision, &[]),
        Err(CommitTaskError::Task(TaskError::InvalidProvenance))
    );
    assert_eq!(engine.task_status("bare"), Some(TaskStatus::Stale));

    // The authorized task still commits.
    engine.start_task("allowed").unwrap();
    let issued = engine.issued_task("allowed").unwrap();
    engine
        .receive_executor_feedback(ExecutorFeedback::Result(
            spaceeyes_simulation::TaskResult::from(&issued),
        ))
        .unwrap();
    engine
        .commit_task_scene("allowed", &issued.token, revision, &[])
        .unwrap();
    assert_eq!(engine.task_status("allowed"), Some(TaskStatus::Completed));
}

#[test]
fn priority_and_token_reject_a_foreign_worker_result() {
    let mut primary = engine();
    primary
        .enqueue_task_with_priority(request("slow"), TaskPriority::Prefetch)
        .unwrap();
    primary
        .enqueue_task_with_priority(request("fast"), TaskPriority::Interactive)
        .unwrap();
    assert_eq!(primary.ready_tasks(), vec!["fast", "slow"]);

    primary.start_task("fast").unwrap();
    let issued = primary.issued_task("fast").unwrap();
    // Same id from another scheduler must be rejected by token identity.
    let mut other = engine();
    other.enqueue_task(request("fast")).unwrap();
    other.start_task("fast").unwrap();
    let foreign = other.issued_task("fast").unwrap();
    assert_eq!(
        primary.accept_task_result(&spaceeyes_simulation::TaskResult::from(&foreign)),
        Err(TaskError::ExecutionMismatch)
    );
    primary
        .accept_task_result(&spaceeyes_simulation::TaskResult::from(&issued))
        .unwrap();
    assert_eq!(primary.task_status("fast"), Some(TaskStatus::ResultReady));
}
