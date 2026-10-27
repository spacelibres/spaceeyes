use spaceeyes_simulation::{SimulationScheduler, TaskRequest, TaskStatus};
use spaceeyes_time::{TimeGeneration, TimeInstant};
#[test]
fn cancellation_propagates_transitively_and_history_can_be_reclaimed() {
    let mut s = SimulationScheduler::new();
    for (id, deps) in [
        ("a", vec![]),
        ("b", vec!["a".into()]),
        ("c", vec!["b".into()]),
    ] {
        s.enqueue(TaskRequest {
            task_id: id.into(),
            generation: TimeGeneration(0),
            requested_instant: TimeInstant::new("TT", "epoch", 0, 0).unwrap(),
            dependencies: deps,
        })
        .unwrap();
    }
    s.cancel("a").unwrap();
    assert_eq!(s.status("b"), Some(TaskStatus::Failed));
    assert_eq!(s.status("c"), Some(TaskStatus::Failed));
    assert_eq!(s.queued_count(), 0);
    for id in ["c", "b", "a"] {
        s.forget_terminal(id).unwrap();
    }
    assert_eq!(s.status("a"), None);
}
