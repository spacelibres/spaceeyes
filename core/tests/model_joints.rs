use spaceeyes_core::{
    AssetDescriptor, AssetKind, Core, CoreError, JointAim, SessionPermissions, VisualSpec,
};
fn aim() -> JointAim {
    serde_json::from_str(r#"{"joint":"panel","hingeAxis":[0,0,1],"normalAxis":[1,0,0],"targetDirectionIcrf":[0,1,0]}"#).unwrap()
}
#[test]
fn joints_are_atomic_owned_and_lifecycle_bound() {
    let mut c = Core::default();
    c.open_session_with_permissions(
        "s",
        "p",
        SessionPermissions {
            visual_control: true,
            ..Default::default()
        },
    )
    .unwrap();
    c.open_session("denied", "q", false).unwrap();
    c.register_object("s", "object:a").unwrap();
    assert_eq!(
        c.set_model_joints("s", "p", "object:a", vec![aim()]),
        Err(CoreError::InvalidVisual)
    );
    c.register_asset(
        "model:a",
        AssetDescriptor {
            kind: AssetKind::Model,
            path: "models/a.gltf".into(),
        },
    )
    .unwrap();
    c.set_visual(
        "s",
        "p",
        "object:a",
        Some(VisualSpec::Model {
            asset_id: "model:a".into(),
            scene: 0,
            scale_km_per_unit: 1.,
            framing_radius_km: None,
        }),
    )
    .unwrap();
    c.set_model_joints("s", "p", "object:a", vec![aim()])
        .unwrap();
    let mut alias = aim();
    alias.joint = "panel name".into();
    let mut alias2 = alias.clone();
    alias2.joint = "panel_name".into();
    assert_eq!(
        c.set_model_joints("s", "p", "object:a", vec![alias, alias2]),
        Err(CoreError::InvalidVisual)
    );

    let mut bad = aim();
    bad.hinge_axis = [0.; 3];
    assert_eq!(
        c.set_model_joints("s", "p", "object:a", vec![bad]),
        Err(CoreError::InvalidVisual)
    );
    assert_eq!(c.model_joints("object:a").unwrap().len(), 1);
    assert_eq!(
        c.set_model_joints("denied", "q", "object:a", vec![]),
        Err(CoreError::PermissionDenied)
    );
    assert_eq!(
        c.set_model_joints("s", "wrong", "object:a", vec![]),
        Err(CoreError::WrongOwner)
    );
    c.set_model_joints("s", "p", "object:a", vec![]).unwrap();
    assert!(c.model_joints("object:a").is_none());
    c.set_model_joints("s", "p", "object:a", vec![aim()])
        .unwrap();
    c.release_session("s");
    assert!(c.model_joints("object:a").is_none());
}
#[test]
fn unknown_fields_rejected() {
    assert!(serde_json::from_str::<JointAim>(r#"{"joint":"x","hingeAxis":[0,0,1],"normalAxis":[1,0,0],"targetDirectionIcrf":[0,1,0],"transform":{}}"#).is_err());
}
