// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! C10: session-bound snapshot publication, STALE fallback, and FramePublished events.
use spaceeyes_engine::Engine;
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, Revision};
use spaceeyes_scene::{SceneCommand, SceneObject};
use spaceeyes_snapshot::FrameAvailability;
use spaceeyes_spatial::SpatialError;
use spaceeyes_time::TimeInstant;

const MAX_FRAME_EVENTS: usize = 64;

fn engine() -> Engine {
    Engine::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap())
}

fn id(s: &str) -> ObjectId {
    ObjectId::new(s).unwrap()
}

fn root() -> FrameId {
    FrameId::new("root").unwrap()
}

/// One scene-bound engine that already published nothing.
fn bound(session: &str) -> Engine {
    let mut e = engine();
    e.bind_session(session).unwrap();
    e.register_root_frame(root()).unwrap();
    e.submit_scene(
        Revision(0),
        &[
            SceneCommand::Create(SceneObject::new(id("body"))),
            SceneCommand::SetFrame {
                object: id("body"),
                frame: Some(root()),
            },
        ],
    )
    .unwrap();
    e
}

#[test]
fn commit_records_session_bound_frame_and_emits_an_event() {
    let mut e = bound("session-a");
    let frame = e.commit_frame(&root()).unwrap();
    assert_eq!(frame.session, "session-a");
    assert_eq!(frame.availability, FrameAvailability::Complete);
    assert_eq!(frame.poses.len(), 1);

    let published = e.published_frame().unwrap();
    assert_eq!(published.session, "session-a");
    assert_eq!(published.sequence, frame.sequence);
    assert_eq!(published.availability, FrameAvailability::Complete);
    assert_eq!(published.scene_revision, frame.scene.revision);
    assert_eq!(published.frame_graph_revision, frame.frame_graph_revision);
    assert_eq!(published.resource_revision, frame.resource_revision);
    assert!(!published.stale);

    let events: Vec<_> = e.frame_events().cloned().collect();
    assert_eq!(events, vec![published]);

    let retained = e.retained_frame().unwrap();
    assert_eq!(retained.availability, FrameAvailability::Complete);
    assert_eq!(retained.sequence, frame.sequence);
    assert_eq!(retained.poses, frame.poses);
}

#[test]
fn failed_publication_keeps_the_last_frame_and_marks_it_stale() {
    let mut e = bound("session-a");
    let first = e.commit_frame(&root()).unwrap();
    let events = e.frame_events().count();

    let missing = FrameId::new("missing").unwrap();
    assert_eq!(e.commit_frame(&missing), Err(SpatialError::UnknownFrame));

    let published = e.published_frame().unwrap();
    assert_eq!(published.sequence, first.sequence);
    assert!(
        published.stale,
        "a failed publication must not look current"
    );
    assert_eq!(e.frame_events().count(), events, "no event without a frame");

    let retained = e.retained_frame().unwrap();
    assert_eq!(retained.availability, FrameAvailability::Stale);
    assert_eq!(retained.poses, first.poses);
    assert_eq!(e.snapshot().sequence, first.sequence);

    // A later consistent publication replaces the stale record.
    let second = e.commit_frame(&root()).unwrap();
    let published = e.published_frame().unwrap();
    assert!(!published.stale);
    assert_eq!(published.sequence, second.sequence);
    assert_eq!(
        e.retained_frame().unwrap().availability,
        FrameAvailability::Complete
    );
}

#[test]
fn any_later_state_change_makes_the_published_frame_stale() {
    let mut e = bound("session-a");
    let first = e.commit_frame(&root()).unwrap();
    e.step_nanos(1).unwrap();
    let published = e.published_frame().unwrap();
    assert!(published.stale);
    assert_eq!(published.sequence, first.sequence);
    assert_eq!(
        e.retained_frame().unwrap().availability,
        FrameAvailability::Stale
    );
}

#[test]
fn partial_capture_is_recorded_without_inventing_complete_state() {
    let mut e = bound("session-a");
    let detached = FrameId::new("detached").unwrap();
    e.register_root_frame(detached.clone()).unwrap();
    e.remove_frame(&root()).unwrap();
    let frame = e.commit_frame(&detached).unwrap();
    assert_eq!(frame.availability, FrameAvailability::Partial);
    assert_eq!(frame.unresolved, vec![id("body")]);
    assert_eq!(
        e.published_frame().unwrap().availability,
        FrameAvailability::Partial
    );
    assert_eq!(
        e.retained_frame().unwrap().availability,
        FrameAvailability::Partial
    );
}

#[test]
fn session_binding_is_single_and_survives_restore() {
    let mut e = bound("session-a");
    e.bind_session("session-a").unwrap();
    assert_eq!(e.bind_session("session-b"), Err(CoreError::InvalidState));
    assert_eq!(e.session(), "session-a");

    let project = e.project_state();
    let mut restored = Engine::restore_project(&project, &[]).unwrap();
    assert_eq!(restored.session(), "");
    restored.bind_session("session-b").unwrap();
    assert_eq!(restored.session(), "session-b");
}

#[test]
fn stopped_engine_rejects_publication_and_freezes_a_stale_frame() {
    let mut e = bound("session-a");
    let frame = e.commit_frame(&root()).unwrap();
    e.shutdown();
    assert_eq!(
        e.commit_frame(&root()),
        Err(SpatialError::EngineUnavailable)
    );
    let published = e.published_frame().unwrap();
    assert!(published.stale);
    assert_eq!(published.sequence, frame.sequence);
    let retained = e.retained_frame().unwrap();
    assert_eq!(retained.availability, FrameAvailability::Stale);
}

#[test]
fn frame_events_are_bounded_and_ordered() {
    let mut e = bound("session-a");
    for step in 0..=MAX_FRAME_EVENTS {
        if step > 0 {
            e.step_nanos(1).unwrap();
        }
        e.commit_frame(&root()).unwrap();
    }
    let events: Vec<_> = e.frame_events().cloned().collect();
    assert_eq!(events.len(), MAX_FRAME_EVENTS);
    let published = e.published_frame().unwrap();
    assert_eq!(events.last(), Some(&published));
    assert!(events
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
}
