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
        core.open_session("a", "one.plugin", true).unwrap();
        core.register_object("a", "body:test").unwrap();
        core.set_object_state(
            "a",
            "body:test",
            ObjectState {
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
