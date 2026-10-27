// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use super::*;
use spaceeyes_scene::{CameraState, CameraTracking, SceneObject};

fn instant() -> TimeInstant {
    TimeInstant::new("TT", "epoch", 0, 0).unwrap()
}
fn id(value: &str) -> ObjectId {
    ObjectId::new(value).unwrap()
}
fn request(engine: &Engine, task_id: &str) -> TaskRequest {
    TaskRequest {
        task_id: task_id.into(),
        generation: engine.clock().generation(),
        requested_instant: engine.clock().instant().clone(),
        dependencies: vec![],
    }
}
fn add(engine: &mut Engine, names: &[&str]) {
    let commands: Vec<_> = names
        .iter()
        .map(|name| SceneCommand::Create(SceneObject::new(id(name))))
        .collect();
    engine
        .submit_scene(engine.scene().revision(), &commands)
        .unwrap();
}
fn ready(engine: &mut Engine, task_id: &str) -> TaskExecutionToken {
    engine.start_task(task_id).unwrap();
    let task = engine.issued_task(task_id).unwrap();
    engine.accept_task_result(&TaskResult::from(&task)).unwrap();
    task.token
}
fn lease(engine: &mut Engine, task: &str) -> ResourceId {
    let resource = ResourceId::new("task-resource").unwrap();
    engine.register_resource(resource.clone(), 10).unwrap();
    engine.attach_task_resource(task, &resource).unwrap();
    resource
}

#[test]
fn foreign_engine_feedback_and_commit_leave_live_task_and_lease_intact() {
    let mut first = Engine::new(instant());
    let mut second = Engine::new(instant());
    first.enqueue_task(request(&first, "same")).unwrap();
    second.enqueue_task(request(&second, "same")).unwrap();
    let foreign = first.issued_task("same").unwrap();
    let resource = lease(&mut second, "same");
    second.start_task("same").unwrap();
    for feedback in [
        ExecutorFeedback::Result(TaskResult::from(&foreign)),
        ExecutorFeedback::Failed {
            task_id: "same".into(),
            token: foreign.token,
        },
        ExecutorFeedback::Cancelled {
            task_id: "same".into(),
            token: foreign.token,
        },
    ] {
        assert_eq!(
            second.receive_executor_feedback(feedback),
            Err(TaskError::ExecutionMismatch)
        );
        assert_eq!(second.task_status("same"), Some(TaskStatus::Running));
        assert_eq!(
            second.unregister_resource(&resource),
            Err(ResourceError::StillLeased)
        );
    }
    let local = second.issued_task("same").unwrap();
    second
        .accept_task_result(&TaskResult::from(&local))
        .unwrap();
    assert_eq!(
        second.commit_task_scene("same", &foreign.token, Revision(0), &[]),
        Err(CommitTaskError::Task(TaskError::ExecutionMismatch))
    );
    assert_eq!(second.task_status("same"), Some(TaskStatus::ResultReady));
    second
        .commit_task_scene("same", &local.token, Revision(0), &[])
        .unwrap();
    second.unregister_resource(&resource).unwrap();
    assert!(second.task_contexts.is_empty());
}

#[test]
fn old_callbacks_cannot_affect_reused_task_id_even_after_new_result_ready() {
    let mut engine = Engine::new(instant());
    engine.enqueue_task(request(&engine, "same")).unwrap();
    let old = engine.issued_task("same").unwrap();
    engine.cancel_task("same").unwrap();
    engine.forget_terminal_task("same").unwrap();
    engine.enqueue_task(request(&engine, "same")).unwrap();
    let current = ready(&mut engine, "same");
    for feedback in [
        ExecutorFeedback::Failed {
            task_id: "same".into(),
            token: old.token,
        },
        ExecutorFeedback::Cancelled {
            task_id: "same".into(),
            token: old.token,
        },
        ExecutorFeedback::Result(TaskResult::from(&old)),
    ] {
        assert_eq!(
            engine.receive_executor_feedback(feedback),
            Err(TaskError::ExecutionMismatch)
        );
        assert_eq!(engine.task_status("same"), Some(TaskStatus::ResultReady));
    }
    assert_eq!(
        engine.commit_task_scene("same", &old.token, Revision(0), &[]),
        Err(CommitTaskError::Task(TaskError::ExecutionMismatch))
    );
    engine
        .commit_task_scene("same", &current, Revision(0), &[])
        .unwrap();
}

#[test]
fn restored_engine_rejects_original_session_identity() {
    let mut original = Engine::new(instant());
    original.enqueue_task(request(&original, "same")).unwrap();
    let old = original.issued_task("same").unwrap();
    let mut restored = Engine::restore_project(&original.project_state(), &[]).unwrap();
    restored.enqueue_task(request(&restored, "same")).unwrap();
    restored.start_task("same").unwrap();
    assert_eq!(
        restored.accept_task_result(&TaskResult::from(&old)),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(restored.task_status("same"), Some(TaskStatus::Running));
}

#[test]
fn deleted_and_recreated_target_is_stale_at_acceptance_or_commit() {
    for invalidate_after_acceptance in [false, true] {
        let mut engine = Engine::new(instant());
        add(&mut engine, &["target"]);
        engine
            .enqueue_task_for_objects(request(&engine, "objects"), &[id("target")])
            .unwrap();
        let resource = lease(&mut engine, "objects");
        let mut dependent = request(&engine, "dependent");
        dependent.dependencies.push("objects".into());
        engine.enqueue_task(dependent).unwrap();
        engine.attach_task_resource("dependent", &resource).unwrap();
        engine.start_task("objects").unwrap();
        let issued = engine.issued_task("objects").unwrap();
        if invalidate_after_acceptance {
            engine
                .accept_task_result(&TaskResult::from(&issued))
                .unwrap();
        }
        engine
            .submit_scene(
                engine.scene().revision(),
                &[
                    SceneCommand::Delete {
                        object: id("target"),
                    },
                    SceneCommand::Create(SceneObject::new(id("target"))),
                ],
            )
            .unwrap();
        let before = engine.snapshot();
        if invalidate_after_acceptance {
            assert_eq!(
                engine.commit_task_scene(
                    "objects",
                    &issued.token,
                    engine.scene().revision(),
                    &[SceneCommand::SetVisibility {
                        object: id("target"),
                        visible: false
                    }]
                ),
                Err(CommitTaskError::Task(TaskError::InvalidTarget))
            );
        } else {
            assert_eq!(
                engine.accept_task_result(&TaskResult::from(&issued)),
                Err(TaskError::InvalidTarget)
            );
        }
        assert_eq!(engine.snapshot(), before);
        assert_eq!(engine.task_status("objects"), Some(TaskStatus::Stale));
        assert_eq!(engine.task_status("dependent"), Some(TaskStatus::Failed));
        assert!(engine.task_contexts.is_empty());
        assert!(engine.task_leases.is_empty());
        engine.unregister_resource(&resource).unwrap();
    }
}

#[test]
fn explicit_targets_allow_unrelated_scene_writes_and_deduplicate() {
    let mut engine = Engine::new(instant());
    add(&mut engine, &["target", "unrelated"]);
    engine
        .enqueue_task_for_objects(request(&engine, "objects"), &[id("target"), id("target")])
        .unwrap();
    assert!(
        matches!(&engine.task_contexts["objects"].targets, TaskTargets::Objects(handles) if handles.len() == 1)
    );
    engine.start_task("objects").unwrap();
    let issued = engine.issued_task("objects").unwrap();
    engine
        .submit_scene(
            engine.scene().revision(),
            &[SceneCommand::SetVisibility {
                object: id("unrelated"),
                visible: false,
            }],
        )
        .unwrap();
    engine
        .accept_task_result(&TaskResult::from(&issued))
        .unwrap();
    add(&mut engine, &["another-unrelated"]);
    engine
        .commit_task_scene(
            "objects",
            &issued.token,
            engine.scene().revision(),
            &[SceneCommand::SetVisibility {
                object: id("target"),
                visible: false,
            }],
        )
        .unwrap();
    assert!(!engine.scene().get(&id("target")).unwrap().visible());
}

#[test]
fn target_declaration_limits_reject_input_before_enqueue() {
    let mut engine = Engine::new(instant());
    add(&mut engine, &["target"]);
    for (targets, expected) in [
        (vec![], TaskError::InvalidTarget),
        (vec![id("missing")], TaskError::InvalidTarget),
        (
            vec![id("target"); MAX_TASK_TARGETS + 1],
            TaskError::TargetLimit,
        ),
    ] {
        assert_eq!(
            engine.enqueue_task_for_objects(request(&engine, "objects"), &targets),
            Err(expected)
        );
        assert!(engine.issued_task("objects").is_none());
        assert!(engine.task_contexts.is_empty());
    }
}

#[test]
fn object_tasks_reject_create_and_undeclared_writes_without_losing_retry() {
    let mut engine = Engine::new(instant());
    add(&mut engine, &["target", "other"]);
    engine
        .enqueue_task_for_objects(request(&engine, "objects"), &[id("target")])
        .unwrap();
    let token = ready(&mut engine, "objects");
    let before = engine.snapshot();
    for (command, expected) in [
        (
            SceneCommand::Create(SceneObject::new(id("created"))),
            TaskError::CreateNotAllowed,
        ),
        (
            SceneCommand::SetVisibility {
                object: id("other"),
                visible: false,
            },
            TaskError::UndeclaredTarget,
        ),
        (
            SceneCommand::SetParent {
                object: id("target"),
                parent: Some(id("other")),
            },
            TaskError::UndeclaredTarget,
        ),
    ] {
        assert_eq!(
            engine.commit_task_scene("objects", &token, engine.scene().revision(), &[command]),
            Err(CommitTaskError::Task(expected))
        );
        assert_eq!(engine.snapshot(), before);
        assert_eq!(engine.task_status("objects"), Some(TaskStatus::ResultReady));
    }
    engine
        .commit_task_scene(
            "objects",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetVisibility {
                object: id("target"),
                visible: false,
            }],
        )
        .unwrap();
}

#[test]
fn object_tasks_bind_parent_and_camera_tracking_dependencies() {
    let mut engine = Engine::new(instant());
    let frame = FrameId::new("root").unwrap();
    engine.register_root_frame(frame.clone()).unwrap();
    add(&mut engine, &["child", "parent", "camera", "tracked"]);
    engine
        .submit_scene(
            engine.scene().revision(),
            &[
                SceneCommand::SetParent {
                    object: id("child"),
                    parent: Some(id("parent")),
                },
                SceneCommand::SetFrame {
                    object: id("tracked"),
                    frame: Some(frame.clone()),
                },
                SceneCommand::SetFrame {
                    object: id("camera"),
                    frame: Some(frame),
                },
            ],
        )
        .unwrap();
    assert_eq!(
        engine.enqueue_task_for_objects(request(&engine, "missing-parent"), &[id("child")]),
        Err(TaskError::UndeclaredTarget)
    );
    engine
        .enqueue_task_for_objects(
            request(&engine, "parent-task"),
            &[id("child"), id("parent")],
        )
        .unwrap();
    let camera = CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0)
        .unwrap()
        .with_tracking(Some(CameraTracking::new(id("tracked"), 10.0).unwrap()))
        .unwrap();
    engine
        .enqueue_task_for_objects(request(&engine, "camera-task"), &[id("camera")])
        .unwrap();
    let token = ready(&mut engine, "camera-task");
    assert_eq!(
        engine.commit_task_scene(
            "camera-task",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetCamera {
                object: id("camera"),
                camera: Some(camera.clone())
            }]
        ),
        Err(CommitTaskError::Task(TaskError::UndeclaredTarget))
    );
    engine.cancel_task("camera-task").unwrap();
    engine
        .enqueue_task_for_objects(
            request(&engine, "camera-declared"),
            &[id("camera"), id("tracked")],
        )
        .unwrap();
    let token = ready(&mut engine, "camera-declared");
    engine
        .commit_task_scene(
            "camera-declared",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetCamera {
                object: id("camera"),
                camera: Some(camera),
            }],
        )
        .unwrap();
    assert_eq!(
        engine.enqueue_task_for_objects(request(&engine, "missing-track"), &[id("camera")]),
        Err(TaskError::UndeclaredTarget)
    );
}

#[test]
fn frame_graph_changes_invalidate_both_context_modes_at_acceptance_and_commit() {
    for explicit in [false, true] {
        for after_acceptance in [false, true] {
            let mut engine = Engine::new(instant());
            add(&mut engine, &["target"]);
            if explicit {
                engine
                    .enqueue_task_for_objects(request(&engine, "graph"), &[id("target")])
                    .unwrap();
            } else {
                engine.enqueue_task(request(&engine, "graph")).unwrap();
            }
            engine.start_task("graph").unwrap();
            let issued = engine.issued_task("graph").unwrap();
            if after_acceptance {
                engine
                    .accept_task_result(&TaskResult::from(&issued))
                    .unwrap();
            }
            engine
                .register_root_frame(FrameId::new("changed").unwrap())
                .unwrap();
            if after_acceptance {
                assert_eq!(
                    engine.commit_task_scene(
                        "graph",
                        &issued.token,
                        engine.scene().revision(),
                        &[]
                    ),
                    Err(CommitTaskError::Task(TaskError::RevisionMismatch))
                );
            } else {
                assert_eq!(
                    engine.accept_task_result(&TaskResult::from(&issued)),
                    Err(TaskError::RevisionMismatch)
                );
            }
            assert_eq!(engine.task_status("graph"), Some(TaskStatus::Stale));
            assert!(engine.task_contexts.is_empty());
        }
    }
}

#[test]
fn cancel_notification_keeps_issued_task_even_if_host_notification_fails() {
    struct RejectCancel {
        cancelled: Option<IssuedTask>,
    }
    impl TaskExecutor for RejectCancel {
        fn dispatch(&mut self, _: IssuedTask) -> Result<(), TaskError> {
            Ok(())
        }
        fn request_cancel(&mut self, task: IssuedTask) -> Result<(), TaskError> {
            self.cancelled = Some(task);
            Err(TaskError::InvalidState)
        }
    }
    let mut engine = Engine::new(instant());
    engine.enqueue_task(request(&engine, "cancel")).unwrap();
    let resource = lease(&mut engine, "cancel");
    let expected = engine.issued_task("cancel").unwrap();
    let mut executor = RejectCancel { cancelled: None };
    assert_eq!(
        engine.cancel_task_with_executor("cancel", &mut executor),
        Err(TaskError::InvalidState)
    );
    assert_eq!(executor.cancelled, Some(expected.clone()));
    assert_eq!(engine.task_status("cancel"), Some(TaskStatus::Cancelled));
    assert!(engine.task_contexts.is_empty());
    engine.unregister_resource(&resource).unwrap();
    assert_eq!(
        engine.accept_task_result(&TaskResult::from(&expected)),
        Err(TaskError::InvalidState)
    );
}

#[test]
fn all_terminal_paths_release_contexts_and_task_resources() {
    for mode in [
        "cancel",
        "fail",
        "seek",
        "stop",
        "dispatch-fail",
        "complete",
        "wrong-instant",
    ] {
        struct FailDispatch;
        impl TaskExecutor for FailDispatch {
            fn dispatch(&mut self, _: IssuedTask) -> Result<(), TaskError> {
                Err(TaskError::InvalidState)
            }
        }
        let mut engine = Engine::new(instant());
        engine.enqueue_task(request(&engine, "task")).unwrap();
        let resource = lease(&mut engine, "task");
        match mode {
            "cancel" => engine.cancel_task("task").unwrap(),
            "fail" => engine.fail_task("task").unwrap(),
            "seek" => engine.seek(instant()).unwrap(),
            "stop" => engine.shutdown(),
            "dispatch-fail" => {
                assert!(engine.dispatch_tasks(&mut FailDispatch).is_err());
            }
            "complete" => {
                let token = ready(&mut engine, "task");
                engine
                    .commit_task_scene("task", &token, Revision(0), &[])
                    .unwrap();
            }
            "wrong-instant" => {
                let token = ready(&mut engine, "task");
                engine.step_nanos(1).unwrap();
                assert_eq!(
                    engine.commit_task_scene("task", &token, Revision(0), &[]),
                    Err(CommitTaskError::Task(TaskError::WrongInstant))
                );
            }
            _ => unreachable!(),
        }
        assert!(engine.task_contexts.is_empty(), "{mode}");
        assert!(engine.task_leases.is_empty(), "{mode}");
        if mode != "stop" {
            engine.unregister_resource(&resource).unwrap();
            engine.forget_terminal_task("task").unwrap();
        }
    }
}

#[test]
fn ordinary_tasks_reject_scene_changes_before_result_acceptance() {
    let mut engine = Engine::new(instant());
    engine.enqueue_task(request(&engine, "ordinary")).unwrap();
    let resource = lease(&mut engine, "ordinary");
    engine.start_task("ordinary").unwrap();
    let issued = engine.issued_task("ordinary").unwrap();
    add(&mut engine, &["change"]);
    let before = engine.snapshot();
    assert_eq!(
        engine.accept_task_result(&TaskResult::from(&issued)),
        Err(TaskError::RevisionMismatch)
    );
    assert_eq!(engine.snapshot(), before);
    assert_eq!(engine.task_status("ordinary"), Some(TaskStatus::Stale));
    assert!(engine.task_contexts.is_empty());
    engine.unregister_resource(&resource).unwrap();
}

#[test]
fn foreign_token_is_rejected_before_an_invalid_context_can_stale_the_task() {
    let mut first = Engine::new(instant());
    let mut local = Engine::new(instant());
    first.enqueue_task(request(&first, "same")).unwrap();
    local.enqueue_task(request(&local, "same")).unwrap();
    let foreign = first.issued_task("same").unwrap();
    let resource = lease(&mut local, "same");
    local.start_task("same").unwrap();
    add(&mut local, &["context-changed"]);
    assert_eq!(
        local.accept_task_result(&TaskResult::from(&foreign)),
        Err(TaskError::ExecutionMismatch)
    );
    assert_eq!(local.task_status("same"), Some(TaskStatus::Running));
    assert_eq!(
        local.unregister_resource(&resource),
        Err(ResourceError::StillLeased)
    );
    let issued = local.issued_task("same").unwrap();
    assert_eq!(
        local.accept_task_result(&TaskResult::from(&issued)),
        Err(TaskError::RevisionMismatch)
    );
    local.unregister_resource(&resource).unwrap();
}

#[test]
fn scene_transaction_error_retains_object_context_and_lease_for_retry() {
    let mut engine = Engine::new(instant());
    add(&mut engine, &["object"]);
    engine
        .enqueue_task_for_objects(request(&engine, "retry"), &[id("object")])
        .unwrap();
    let resource = lease(&mut engine, "retry");
    let token = ready(&mut engine, "retry");
    let before = engine.snapshot();
    assert_eq!(
        engine.commit_task_scene(
            "retry",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetParent {
                object: id("object"),
                parent: Some(id("object"))
            }]
        ),
        Err(CommitTaskError::Scene(CoreError::HierarchyCycle))
    );
    assert_eq!(engine.snapshot(), before);
    assert_eq!(engine.task_status("retry"), Some(TaskStatus::ResultReady));
    assert!(engine.task_contexts.contains_key("retry"));
    assert_eq!(
        engine.unregister_resource(&resource),
        Err(ResourceError::StillLeased)
    );
    engine
        .commit_task_scene(
            "retry",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetVisibility {
                object: id("object"),
                visible: false,
            }],
        )
        .unwrap();
    engine.unregister_resource(&resource).unwrap();
}

#[test]
fn declared_parent_generation_is_rechecked_even_when_only_child_is_written() {
    let mut engine = Engine::new(instant());
    add(&mut engine, &["child", "parent"]);
    engine
        .submit_scene(
            engine.scene().revision(),
            &[SceneCommand::SetParent {
                object: id("child"),
                parent: Some(id("parent")),
            }],
        )
        .unwrap();
    engine
        .enqueue_task_for_objects(
            request(&engine, "parent-generation"),
            &[id("child"), id("parent")],
        )
        .unwrap();
    let token = ready(&mut engine, "parent-generation");
    engine
        .submit_scene(
            engine.scene().revision(),
            &[
                SceneCommand::SetParent {
                    object: id("child"),
                    parent: None,
                },
                SceneCommand::Delete {
                    object: id("parent"),
                },
                SceneCommand::Create(SceneObject::new(id("parent"))),
                SceneCommand::SetParent {
                    object: id("child"),
                    parent: Some(id("parent")),
                },
            ],
        )
        .unwrap();
    assert_eq!(
        engine.commit_task_scene(
            "parent-generation",
            &token,
            engine.scene().revision(),
            &[SceneCommand::SetVisibility {
                object: id("child"),
                visible: false
            }]
        ),
        Err(CommitTaskError::Task(TaskError::InvalidTarget))
    );
    assert_eq!(
        engine.task_status("parent-generation"),
        Some(TaskStatus::Stale)
    );
    assert!(engine.scene().get(&id("child")).unwrap().visible());
}

#[test]
fn target_value_changes_before_acceptance_invalidate_object_task() {
    for change_frame in [false, true] {
        let mut engine = Engine::new(instant());
        let frame = FrameId::new("existing-root").unwrap();
        engine.register_root_frame(frame.clone()).unwrap();
        add(&mut engine, &["target"]);
        engine
            .enqueue_task_for_objects(request(&engine, "bound-value"), &[id("target")])
            .unwrap();
        let resource = lease(&mut engine, "bound-value");
        engine.start_task("bound-value").unwrap();
        let task = engine.issued_task("bound-value").unwrap();
        let command = if change_frame {
            SceneCommand::SetFrame {
                object: id("target"),
                frame: Some(frame),
            }
        } else {
            SceneCommand::SetVisibility {
                object: id("target"),
                visible: false,
            }
        };
        engine
            .submit_scene(engine.scene().revision(), &[command])
            .unwrap();
        let before = engine.snapshot();
        assert_eq!(
            engine.accept_task_result(&TaskResult::from(&task)),
            Err(TaskError::RevisionMismatch)
        );
        assert_eq!(engine.snapshot(), before);
        assert_eq!(engine.task_status("bound-value"), Some(TaskStatus::Stale));
        assert!(engine.task_contexts.is_empty());
        engine.unregister_resource(&resource).unwrap();
    }
}

#[test]
fn target_camera_or_declared_parent_change_after_acceptance_cannot_commit_old_result() {
    for change_camera in [false, true] {
        let mut engine = Engine::new(instant());
        let frame = FrameId::new("existing-root").unwrap();
        engine.register_root_frame(frame.clone()).unwrap();
        add(&mut engine, &["target", "parent-a", "parent-b"]);
        engine
            .submit_scene(
                engine.scene().revision(),
                &[
                    SceneCommand::SetFrame {
                        object: id("target"),
                        frame: Some(frame),
                    },
                    SceneCommand::SetParent {
                        object: id("target"),
                        parent: Some(id("parent-a")),
                    },
                ],
            )
            .unwrap();
        engine
            .enqueue_task_for_objects(
                request(&engine, "ready-value"),
                &[id("target"), id("parent-a"), id("parent-b")],
            )
            .unwrap();
        let resource = lease(&mut engine, "ready-value");
        let token = ready(&mut engine, "ready-value");
        let command = if change_camera {
            SceneCommand::SetCamera {
                object: id("target"),
                camera: Some(
                    CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0).unwrap(),
                ),
            }
        } else {
            SceneCommand::SetParent {
                object: id("target"),
                parent: Some(id("parent-b")),
            }
        };
        engine
            .submit_scene(engine.scene().revision(), &[command])
            .unwrap();
        let before = engine.snapshot();
        assert_eq!(
            engine.commit_task_scene(
                "ready-value",
                &token,
                engine.scene().revision(),
                &[SceneCommand::SetVisibility {
                    object: id("target"),
                    visible: false
                }]
            ),
            Err(CommitTaskError::Task(TaskError::RevisionMismatch))
        );
        assert_eq!(engine.snapshot(), before);
        assert_eq!(engine.task_status("ready-value"), Some(TaskStatus::Stale));
        assert!(engine.task_contexts.is_empty());
        engine.unregister_resource(&resource).unwrap();
    }
}

#[test]
fn declared_dependency_value_changes_are_rechecked_at_both_boundaries() {
    for after_acceptance in [false, true] {
        for tracked in [false, true] {
            let mut engine = Engine::new(instant());
            let frame = FrameId::new("existing-root").unwrap();
            engine.register_root_frame(frame.clone()).unwrap();
            add(&mut engine, &["target", "dependency"]);
            let relationship = if tracked {
                let camera = CameraState::new([0.0; 3], [1.0, 0.0, 0.0, 0.0], 1.0, 0.1, 100.0)
                    .unwrap()
                    .with_tracking(Some(CameraTracking::new(id("dependency"), 10.0).unwrap()))
                    .unwrap();
                SceneCommand::SetCamera {
                    object: id("target"),
                    camera: Some(camera),
                }
            } else {
                SceneCommand::SetParent {
                    object: id("target"),
                    parent: Some(id("dependency")),
                }
            };
            engine
                .submit_scene(
                    engine.scene().revision(),
                    &[
                        SceneCommand::SetFrame {
                            object: id("target"),
                            frame: Some(frame.clone()),
                        },
                        SceneCommand::SetFrame {
                            object: id("dependency"),
                            frame: Some(frame),
                        },
                        relationship,
                    ],
                )
                .unwrap();
            engine
                .enqueue_task_for_objects(
                    request(&engine, "dependency-value"),
                    &[id("target"), id("dependency")],
                )
                .unwrap();
            engine.start_task("dependency-value").unwrap();
            let task = engine.issued_task("dependency-value").unwrap();
            if after_acceptance {
                engine.accept_task_result(&TaskResult::from(&task)).unwrap();
            }
            engine
                .submit_scene(
                    engine.scene().revision(),
                    &[SceneCommand::SetVisibility {
                        object: id("dependency"),
                        visible: false,
                    }],
                )
                .unwrap();
            let before = engine.snapshot();
            if after_acceptance {
                assert_eq!(
                    engine.commit_task_scene(
                        "dependency-value",
                        &task.token,
                        engine.scene().revision(),
                        &[]
                    ),
                    Err(CommitTaskError::Task(TaskError::RevisionMismatch))
                );
            } else {
                assert_eq!(
                    engine.accept_task_result(&TaskResult::from(&task)),
                    Err(TaskError::RevisionMismatch)
                );
            }
            assert_eq!(engine.snapshot(), before);
            assert_eq!(
                engine.task_status("dependency-value"),
                Some(TaskStatus::Stale)
            );
            assert!(engine.task_contexts.is_empty());
        }
    }
}
