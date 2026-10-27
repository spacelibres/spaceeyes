// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C12: replayable bounded event stream with explicit loss detection.
use spaceeyes_engine::{Command, CommandDispatcher, DispatchError, Engine, EventKind};
use spaceeyes_foundation::{ObjectId, Revision};
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_time::{TimeGeneration, TimeInstant};

fn instant(seconds: i64) -> TimeInstant {
    TimeInstant::new("TT", "explicit", seconds, 0).unwrap()
}

fn dispatcher(capacity: usize) -> CommandDispatcher {
    CommandDispatcher::new(Engine::new(instant(0)), "session-a".into(), capacity).unwrap()
}

fn bounded_dispatcher(history: usize, events: usize) -> CommandDispatcher {
    CommandDispatcher::with_event_capacity(
        Engine::new(instant(0)),
        "session-a".into(),
        history,
        events,
    )
    .unwrap()
}

fn id(name: &str) -> ObjectId {
    ObjectId::new(name).unwrap()
}

fn create(name: &str, revision: u64) -> Command {
    Command::Scene {
        expected_revision: Revision(revision),
        commands: vec![SceneCommand::Create(SceneObject::new(id(name)))],
    }
}

fn submit(dispatcher: &mut CommandDispatcher, request: &str, command: Command) {
    dispatcher
        .submit("session-a", "host", request, command)
        .unwrap();
}

#[test]
fn scene_clock_and_frame_events_are_typed_and_ordered() {
    let mut d = dispatcher(16);
    submit(&mut d, "c1", create("body", 0));
    submit(&mut d, "seek", Command::Seek(instant(1)));

    let page = d.events_after(0, 16).unwrap();
    assert_eq!(page.replay_from, 1);
    assert_eq!(page.next_sequence, 2);
    assert_eq!(page.events.len(), 2);
    let first = &page.events[0];
    assert_eq!(first.sequence, 1);
    assert_eq!(first.kind, EventKind::SceneChanged);
    assert_eq!(first.session, "session-a");
    assert_eq!(first.command_sequence, 1);
    assert_eq!(first.request_id, "c1");
    assert_eq!(first.scene_revision, Revision(1));
    assert_eq!(first.frame_sequence, 1);
    let second = &page.events[1];
    assert_eq!(second.kind, EventKind::ClockChanged);
    assert_eq!(second.time_generation, TimeGeneration(1));
    assert_eq!(second.command_sequence, 2);

    // Replaying after the last delivered sequence returns an empty page.
    let page = d.events_after(2, 16).unwrap();
    assert!(page.events.is_empty());
    assert_eq!(page.next_sequence, 2);
}

#[test]
fn failed_commands_and_idempotent_retries_do_not_duplicate_events() {
    let mut d = dispatcher(16);
    submit(&mut d, "c1", create("body", 0));
    assert_eq!(
        d.submit("session-a", "host", "c2", create("late", 0)),
        Err(DispatchError::Domain(
            spaceeyes_foundation::CoreError::RevisionConflict
        ))
    );
    submit(&mut d, "c1", create("body", 0));
    assert_eq!(d.event_sequence(), 1);
    assert_eq!(d.events_after(0, 16).unwrap().events.len(), 1);
}

#[test]
fn event_buffer_is_bounded_and_reports_the_replay_window() {
    let mut d = bounded_dispatcher(16, 2);
    submit(&mut d, "c1", create("a", 0));
    submit(&mut d, "c2", create("b", 1));
    submit(&mut d, "c3", create("c", 2));

    let page = d.events_after(0, 16).unwrap();
    assert_eq!(page.events.len(), 2);
    assert_eq!(page.replay_from, 2, "sequence 1 was dropped");
    assert_eq!(page.next_sequence, 3);
    assert_eq!(page.events[0].sequence, 2);
    assert_eq!(page.events[1].sequence, 3);
    // A client stuck at cursor 0 can detect that it lost sequence 1.
    assert!(page.replay_from > 1);
    // A still-valid cursor within the window replays exactly the missing tail.
    let page = d.events_after(2, 16).unwrap();
    assert_eq!(page.events.len(), 1);
    assert_eq!(page.events[0].sequence, 3);
}

#[test]
fn invalid_cursors_and_page_sizes_are_rejected_without_state_changes() {
    let mut d = dispatcher(4);
    submit(&mut d, "c1", create("a", 0));
    assert_eq!(d.events_after(0, 0), Err(DispatchError::InvalidContext));
    assert_eq!(d.events_after(0, 129), Err(DispatchError::InvalidContext));
    assert_eq!(
        d.events_after(5, 4),
        Err(DispatchError::StaleGeneration),
        "a cursor from a lost or foreign session must not look up to date"
    );
    assert_eq!(d.snapshot().sequence, 1);
    assert_eq!(d.command_sequence(), 1);
}
