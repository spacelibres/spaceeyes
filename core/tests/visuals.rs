use spaceeyes_core::{
    AssetDescriptor, AssetKind, Core, CoreError, SessionPermissions, VisualPhase, VisualSpec,
};

fn setup() -> Core {
    let mut core = Core::default();
    core.open_session_with_permissions(
        "owner",
        "one.plugin",
        SessionPermissions {
            visual_control: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.open_session_with_permissions(
        "other",
        "two.plugin",
        SessionPermissions {
            visual_control: true,
            ..Default::default()
        },
    )
    .unwrap();
    core.open_session("denied", "no.permission", false).unwrap();
    core.register_object("owner", "object:test").unwrap();
    core.register_asset(
        "model:juno",
        AssetDescriptor {
            kind: AssetKind::Model,
            path: "models/juno/Juno.gltf".into(),
        },
    )
    .unwrap();
    core
}

fn model() -> VisualSpec {
    VisualSpec::Model {
        asset_id: "model:juno".into(),
        scene: 0,
        scale_km_per_unit: 0.001,
    }
}

#[test]
fn visual_changes_require_ownership_permission_and_registered_assets() {
    let mut core = setup();
    assert_eq!(
        core.set_visual("denied", "no.permission", "object:test", Some(model())),
        Err(CoreError::PermissionDenied)
    );
    assert_eq!(
        core.set_visual("other", "two.plugin", "object:test", Some(model())),
        Err(CoreError::WrongOwner)
    );
    let missing = VisualSpec::Sphere {
        texture_asset: Some("missing:image".into()),
        face_assets: None,
        ring_assets: None,
        ring_inner_radius_ratio: None,
        ring_outer_radius_ratio: None,
        color_rgba: None,
        emissive_rgba: None,
    };
    assert_eq!(
        core.set_visual("owner", "one.plugin", "object:test", Some(missing)),
        Err(CoreError::UnknownAsset)
    );
    core.set_visual("owner", "one.plugin", "object:test", Some(model()))
        .unwrap();
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Pending
    );
}

#[test]
fn stale_load_completions_cannot_resurrect_replaced_or_removed_visuals() {
    let mut core = setup();
    core.set_visual("owner", "one.plugin", "object:test", Some(model()))
        .unwrap();
    let old = core.visual_assignment("object:test").unwrap().revision;
    core.set_visual(
        "owner",
        "one.plugin",
        "object:test",
        Some(VisualSpec::Sphere {
            texture_asset: None,
            face_assets: None,
            ring_assets: None,
            ring_inner_radius_ratio: None,
            ring_outer_radius_ratio: None,
            color_rgba: None,
            emissive_rgba: None,
        }),
    )
    .unwrap();
    let new = core.visual_assignment("object:test").unwrap().revision;
    assert!(new > old);
    assert!(!core.record_visual_status("object:test", old, VisualPhase::Ready, None));
    assert!(core.record_visual_status("object:test", new, VisualPhase::Ready, None));
    core.release_session("owner");
    assert!(!core.record_visual_status("object:test", new, VisualPhase::Ready, None));
    assert_eq!(
        core.visual_status("object:test"),
        Err(CoreError::UnknownObject)
    );
    core.register_object("other", "object:test").unwrap();
    core.set_visual("other", "two.plugin", "object:test", Some(model()))
        .unwrap();
    assert!(!core.record_visual_status("object:test", new, VisualPhase::Ready, None));
}

#[test]
fn catalog_rejects_remote_escaping_and_incompatible_resource_paths() {
    let mut core = Core::default();
    for path in [
        "https://example.com/a.gltf",
        "../a.gltf",
        "/a.gltf",
        "models/%2e%2e/a.gltf",
        "models/a.gltf#Scene0",
        "models/a.jpg",
    ] {
        assert_eq!(
            core.register_asset(
                "asset:test",
                AssetDescriptor {
                    kind: AssetKind::Model,
                    path: path.into()
                }
            ),
            Err(CoreError::InvalidAsset)
        );
    }
    core.register_asset(
        "asset:test",
        AssetDescriptor {
            kind: AssetKind::Texture,
            path: "textures/a.jpg".into(),
        },
    )
    .unwrap();
    assert_eq!(
        core.register_asset(
            "asset:test",
            AssetDescriptor {
                kind: AssetKind::Texture,
                path: "textures/b.jpg".into()
            }
        ),
        Err(CoreError::DuplicateAsset)
    );
}

#[test]
fn rings_require_registered_textures_and_ordered_physical_ratios() {
    let mut core = setup();
    for id in ["ring:top", "ring:bottom"] {
        core.register_asset(
            id,
            AssetDescriptor {
                kind: AssetKind::Texture,
                path: format!("{}.png", id.replace(':', "-")),
            },
        )
        .unwrap();
    }
    let make = |inner, outer| VisualSpec::Sphere {
        texture_asset: None,
        face_assets: None,
        ring_assets: Some(["ring:top".into(), "ring:bottom".into()]),
        ring_inner_radius_ratio: Some(inner),
        ring_outer_radius_ratio: Some(outer),
        color_rgba: None,
        emissive_rgba: None,
    };
    assert_eq!(
        core.set_visual("owner", "one.plugin", "object:test", Some(make(2., 1.))),
        Err(CoreError::InvalidVisual)
    );
    assert_eq!(
        core.set_visual("owner", "one.plugin", "object:test", Some(make(1., 11.))),
        Err(CoreError::InvalidVisual)
    );
    assert!(
        core.set_visual("owner", "one.plugin", "object:test", Some(make(1.2, 2.3)))
            .is_ok()
    );
}

#[test]
fn multipart_visual_ready_waits_for_both_rings_and_failure_is_terminal() {
    let mut core = setup();
    for id in ["ring:top", "ring:bottom"] {
        core.register_asset(
            id,
            AssetDescriptor {
                kind: AssetKind::Texture,
                path: format!("{}.png", id.replace(':', "-")),
            },
        )
        .unwrap();
    }
    let spec: VisualSpec=serde_json::from_value(serde_json::json!({"kind":"sphere","ringAssets":["ring:top","ring:bottom"],"ringInnerRadiusRatio":1.2,"ringOuterRadiusRatio":2.3})).unwrap();
    core.set_visual("owner", "one.plugin", "object:test", Some(spec.clone()))
        .unwrap();
    let rev = core.visual_assignment("object:test").unwrap().revision;
    core.record_visual_status("object:test", rev, VisualPhase::Ready, None);
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Loading
    );
    core.record_visual_part_ready("object:test", rev, "ring-top");
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Loading
    );
    core.record_visual_part_ready("object:test", rev, "ring-bottom");
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Ready
    );
    core.record_visual_status(
        "object:test",
        rev,
        VisualPhase::Failed,
        Some("part failed".into()),
    );
    assert!(!core.record_visual_status("object:test", rev, VisualPhase::Ready, None));
    assert!(!core.record_visual_part_ready("object:test", rev, "ring-bottom"));
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Failed
    );
    core.set_visual("owner", "one.plugin", "object:test", Some(spec))
        .unwrap();
    assert_eq!(
        core.visual_status("object:test").unwrap().unwrap().phase,
        VisualPhase::Pending
    );
}
