use spaceeyes_core::{Core, CoreError, SessionPermissions, TrajectoryStyle};
#[test]
fn timed_annotations_validate_atomically_and_follow_object_lifecycle() {
    let mut core = Core::default();
    core.open_session_with_permissions(
        "s",
        "source.test",
        SessionPermissions {
            visual_control: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.register_object("s", "earth").unwrap();
    core.register_object("s", "moon").unwrap();
    core.set_trajectory_with_style(
        "s",
        "source.test",
        "moon",
        vec![[0.; 3], [1.; 3]],
        vec![0., 10.],
        TrajectoryStyle {
            origin_id: Some("earth".into()),
            color_rgba: Some([0.2, 0.5, 1., 1.]),
        },
    )
    .unwrap();
    assert_eq!(
        core.trajectory_style("moon").unwrap().origin_id.as_deref(),
        Some("earth")
    );
    let points = vec![[0., 0., 0.], [1., 0., 0.]];
    core.set_timed_trajectory("s", "source.test", "earth", points.clone(), vec![0., 10.])
        .unwrap();
    for epochs in [vec![10., 0.], vec![0., 0.], vec![0.], vec![0., f64::NAN]] {
        assert_eq!(
            core.set_timed_trajectory("s", "source.test", "earth", points.clone(), epochs),
            Err(CoreError::InvalidVisual)
        );
        assert_eq!(core.trajectory_epochs("earth"), Some([0., 10.].as_slice()));
    }
    core.set_annotation("s", "source.test", "earth", Some(points.clone()), None)
        .unwrap();
    assert_eq!(core.trajectory_epochs("earth"), None);
    core.set_timed_trajectory("s", "source.test", "earth", points, vec![0., 10.])
        .unwrap();
    core.release_session("s");
    assert_eq!(core.trajectory_epochs("earth"), None);
    assert!(core.trajectory_style("moon").is_none());
}
