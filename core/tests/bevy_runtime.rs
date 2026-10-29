#![cfg(feature = "bevy-runtime")]
use bevy::prelude::*;
use spaceeyes_core::{
    Core, DisplaySettings, ObjectState, SceneObject, SharedCore, SyncReport, create_headless_app,
};
use std::sync::{Arc, Mutex};

#[test]
fn real_bevy_entities_follow_core_and_use_double_precision_local_origin() {
    let shared: SharedCore = Arc::new(Mutex::new(Core::default()));
    {
        let mut core = shared.lock().unwrap();
        core.open_session_with_permissions(
            "a",
            "one.plugin",
            spaceeyes_core::SessionPermissions {
                camera_control: true,
                visual_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        core.register_object("a", "body:test").unwrap();
        core.set_object_state(
            "a",
            "body:test",
            ObjectState {
                orientation_wxyz: None,
                position_km: [1e12 + 1.0, 2.0, 3.0],
                radius_km: 1.0,
                epoch_tdb_seconds: 0.0,
                coverage_tdb_seconds: [0.0, 10.0],
                frame: "ICRF".into(),
                source: "fixture".into(),
            },
        )
        .unwrap();
    }
    let mut app = create_headless_app(shared.clone());
    app.insert_resource(DisplaySettings::new([1e12, 0.0, 0.0], 1.0).unwrap());
    app.update();
    let world = app.world_mut();
    let mut query = world.query::<(&SceneObject, &Transform)>();
    let (object, transform) = query.single(world).unwrap();
    assert_eq!(object.id, "body:test");
    assert_eq!(transform.translation, Vec3::new(1.0, 3.0, -2.0));
    assert_eq!(world.resource::<SyncReport>().visible, 1);
    {
        let mut core = shared.lock().unwrap();
        let mut sample = core.object_state_at("body:test", 0.0).unwrap().clone();
        sample.position_km[0] += 1.0;
        core.set_object_state("a", "body:test", sample).unwrap();
    }
    app.update();
    let world = app.world_mut();
    let mut query = world.query::<(&SceneObject, &Transform)>();
    assert_eq!(
        query.single(world).unwrap().1.translation,
        Vec3::new(2.0, 3.0, -2.0)
    );
    {
        let mut core = shared.lock().unwrap();
        core.register_asset(
            "model:test",
            spaceeyes_core::AssetDescriptor {
                kind: spaceeyes_core::AssetKind::Model,
                path: "models/test.glb".into(),
            },
        )
        .unwrap();
        core.set_visual(
            "a",
            "one.plugin",
            "body:test",
            Some(spaceeyes_core::VisualSpec::Model {
                asset_id: "model:test".into(),
                scene: 0,
                scale_km_per_unit: 0.001,
            }),
        )
        .unwrap();
    }
    app.update();
    let world = app.world_mut();
    let mut query = world.query::<(&SceneObject, &Transform)>();
    assert_eq!(query.single(world).unwrap().1.scale, Vec3::splat(0.001));
    shared.lock().unwrap().release_session("a");
    app.update();
    assert_eq!(
        app.world_mut()
            .query::<&SceneObject>()
            .iter(app.world())
            .count(),
        0
    );
}

#[test]
fn stale_samples_are_reported_and_do_not_remain_in_the_scene() {
    let shared: SharedCore = Arc::new(Mutex::new(Core::default()));
    {
        let mut core = shared.lock().unwrap();
        core.open_session("a", "one.plugin", false).unwrap();
        core.register_object("a", "body:no-sample").unwrap();
    }
    let mut app = create_headless_app(shared);
    app.update();
    assert_eq!(app.world().resource::<SyncReport>().visible, 0);
    assert_eq!(app.world().resource::<SyncReport>().unavailable.len(), 1);
    assert!(DisplaySettings::new([f64::NAN, 0.0, 0.0], 1.0).is_err());
    assert!(DisplaySettings::new([0.0; 3], 0.0).is_err());
}
#[test]
fn clock_epoch_survives_json_publication_without_respawning_scene() {
    let shared: SharedCore = Arc::new(Mutex::new(Core::default()));
    {
        let mut core = shared.lock().unwrap();
        core.open_session_with_permissions(
            "s",
            "p",
            spaceeyes_core::SessionPermissions {
                data_publish: true,
                time_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        core.set_playback("s", "p", true, 100.0).unwrap();
    }
    let mut app = create_headless_app(shared.clone());
    let mut previous = None;
    for _ in 0..1000 {
        {
            let mut core = shared.lock().unwrap();
            core.tick(0.016666666666666666).unwrap();
            let epoch = core.clock().epoch();
            let sample = ObjectState {
                orientation_wxyz: None,
                position_km: [0.0; 3],
                radius_km: 1.0,
                epoch_tdb_seconds: epoch,
                coverage_tdb_seconds: [0.0, 10000.0],
                frame: "ICRF".into(),
                source: "fixture".into(),
            };
            let json = serde_json::to_string(&sample).unwrap();
            let parsed: ObjectState = serde_json::from_str(&json).unwrap();
            assert_eq!(
                epoch.to_bits(),
                parsed.epoch_tdb_seconds.to_bits(),
                "JSON epoch changed: {json}"
            );
            core.publish_object("s", "p", "body:a", parsed).unwrap();
        }
        app.update();
        let world = app.world_mut();
        let entity = world
            .query_filtered::<Entity, With<SceneObject>>()
            .single(world)
            .unwrap();
        if let Some(previous) = previous {
            assert_eq!(entity, previous);
        }
        previous = Some(entity);
    }
}
