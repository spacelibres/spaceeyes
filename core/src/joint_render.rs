//! Controlled single-axis model articulation. Science target directions come
//! from the TS source; model hierarchy and graphics rotations stay in Bevy.
use crate::{JointAim, render_assets::VisualRoot, runtime::CoreStore};
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

#[derive(Resource, Default)]
pub(crate) struct JointRenderState {
    rigs: HashMap<Entity, Rig>,
    originals: HashMap<Entity, Quat>,
}
struct Rig {
    revision: u64,
    names: HashMap<String, Vec<Entity>>,
    error: Option<String>,
}
type Nodes<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static Transform,
        Option<&'static ChildOf>,
        Option<&'static Children>,
        Option<&'static Name>,
    ),
>;

// Match Three.PropertyBinding.sanitizeNodeName, used by NASA GLTF loading.
// Preserve original asset names; aliases are accepted only when unambiguous.
fn source_node_name(name: &str) -> String {
    crate::model_joints::canonical_joint_name(name)
}

/// Axis names in NASA controllers are model-local, not already display axes.
/// Parent rotation includes the asset conversion B and all animated ancestors.
fn hinge_rotation(parent: Quat, aim: &JointAim) -> Option<Quat> {
    let v = |a: [f64; 3]| Vec3::new(a[0] as f32, a[1] as f32, a[2] as f32);
    let hinge = v(aim.hinge_axis).try_normalize()?;
    let normal = v(aim.normal_axis).try_normalize()?;
    let [x, y, z] = aim.target_direction_icrf;
    let target = parent.inverse() * Vec3::new(x as f32, z as f32, -y as f32);
    let projected = target - hinge * target.dot(hinge);
    // At a pole the single-axis optimum is not unique. Use zero angle, which
    // is deterministic under pause/seek and never invents a gimbal degree.
    let Some(projected) = projected.try_normalize() else {
        return Some(Quat::IDENTITY);
    };
    let normal = (normal - hinge * normal.dot(hinge)).try_normalize()?;
    let angle = hinge
        .dot(normal.cross(projected))
        .atan2(normal.dot(projected));
    let q = Quat::from_axis_angle(hinge, angle);
    q.is_finite().then_some(q)
}

fn parent_rotation(
    entity: Entity,
    nodes: &Nodes,
    overrides: &HashMap<Entity, Quat>,
) -> Option<(usize, Quat)> {
    let mut current = nodes.get(entity).ok()?.2.map(ChildOf::parent);
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if chain.len() >= 128 || !seen.insert(id) {
            return None;
        }
        let (_, t, parent, _, _) = nodes.get(id).ok()?;
        chain.push(overrides.get(&id).copied().unwrap_or(t.rotation));
        current = parent.map(ChildOf::parent);
    }
    let rotation = chain.iter().rev().fold(Quat::IDENTITY, |a, b| a * *b);
    (rotation.is_finite() && rotation.length_squared() > 1e-8)
        .then(|| (chain.len(), rotation.normalize()))
}

pub(crate) fn apply_model_joints(
    store: Res<CoreStore>,
    roots: Query<(Entity, &VisualRoot)>,
    mut nodes: ParamSet<(Nodes, Query<&mut Transform>)>,
    mut state: ResMut<JointRenderState>,
) {
    let Ok(mut core) = store.0.lock() else { return };
    let mut active_roots = HashSet::new();
    let mut active_nodes = HashSet::new();
    // Restore removed parent constraints before evaluating retained children.
    // Active parent constraints then overwrite these baselines in depth order.
    let mut writes = state.originals.clone();
    {
        let read = nodes.p0();
        for (root_id, root) in &roots {
            let Some(aims) = core.model_joints(&root.object).cloned() else {
                continue;
            };
            if !root.instance_ready {
                continue;
            }
            if core
                .visual_assignment(&root.object)
                .is_none_or(|v| v.revision != root.revision)
            {
                continue;
            }
            active_roots.insert(root_id);
            let rig = state.rigs.entry(root_id).or_insert_with(|| Rig {
                revision: root.revision,
                names: HashMap::new(),
                error: None,
            });
            if rig.revision != root.revision || rig.names.is_empty() && rig.error.is_none() {
                rig.revision = root.revision;
                rig.names.clear();
                let mut queue = vec![root_id];
                let mut seen = HashSet::new();
                while let Some(id) = queue.pop() {
                    if !seen.insert(id) || seen.len() > 8192 {
                        rig.error = Some("Model hierarchy exceeds joint traversal budget".into());
                        break;
                    }
                    let Ok((_, _, _, children, name)) = read.get(id) else {
                        continue;
                    };
                    if let Some(name) = name {
                        let names = rig
                            .names
                            .entry(source_node_name(name.as_str()))
                            .or_default();
                        if !names.contains(&id) {
                            names.push(id);
                        }
                    }
                    if let Some(children) = children {
                        queue.extend(children.iter());
                    }
                }
            }
            let mut missing = Vec::new();
            let mut ambiguous = Vec::new();
            let mut bound = Vec::new();
            let error = rig.error.clone();
            for aim in aims {
                match rig
                    .names
                    .get(&source_node_name(&aim.joint))
                    .map(Vec::as_slice)
                {
                    Some([id]) => {
                        if let Some((depth, _)) = parent_rotation(*id, &read, &HashMap::new()) {
                            bound.push((depth, *id, aim));
                        } else {
                            missing.push(aim.joint);
                        }
                    }
                    Some(_) => ambiguous.push(aim.joint),
                    None => missing.push(aim.joint),
                }
            }
            // ISS hinges are nested. An inner wing must use the truss pose
            // computed in THIS frame, not last frame's GlobalTransform.
            bound.sort_by_key(|(depth, _, _)| *depth);
            let mut applied = Vec::new();
            if error.is_none() {
                for (_, id, aim) in bound {
                    let Some((_, parent)) = parent_rotation(id, &read, &writes) else {
                        missing.push(aim.joint);
                        continue;
                    };
                    let Some(rotation) = hinge_rotation(parent, &aim) else {
                        missing.push(aim.joint);
                        continue;
                    };
                    if let Ok((_, transform, _, _, _)) = read.get(id) {
                        state.originals.entry(id).or_insert(transform.rotation);
                        active_nodes.insert(id);
                        writes.insert(id, rotation);
                        applied.push(aim.joint);
                    }
                }
            }
            core.record_model_joint_status(&root.object, serde_json::json!({
                "phase": if error.is_some() {"failed"} else if missing.is_empty() && ambiguous.is_empty() {"ready"} else {"partial"},
                "applied":applied,"missing":missing,"ambiguous":ambiguous,"detail":error
            }));
        }
    }
    state.rigs.retain(|id, _| active_roots.contains(id));
    let removed: Vec<_> = state
        .originals
        .keys()
        .filter(|id| !active_nodes.contains(id))
        .copied()
        .collect();
    for id in removed {
        if let Some(rotation) = state.originals.remove(&id) {
            writes.insert(id, rotation);
        }
    }
    let mut writable = nodes.p1();
    for (id, rotation) in writes {
        if let Ok(mut transform) = writable.get_mut(id) {
            transform.rotation = rotation;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn aim(hinge: [f64; 3], normal: [f64; 3], target: [f64; 3]) -> JointAim {
        JointAim {
            joint: "panel".into(),
            hinge_axis: hinge,
            normal_axis: normal,
            target_direction_icrf: target,
        }
    }
    #[test]
    fn solar_hinge_respects_parent_frame_and_replays_without_accumulation() {
        let frame =
            Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2) * Quat::from_rotation_y(0.8);
        let a = aim([1., 0., 0.], [0., 0., 1.], [0.3, 0.7, 0.4]);
        let q = hinge_rotation(frame, &a).unwrap();
        let hinge = frame * Vec3::X;
        let normal = frame * q * Vec3::Z;
        let target = Vec3::new(0.3, 0.4, -0.7);
        let desired = (target - hinge * target.dot(hinge)).normalize();
        assert!(normal.dot(desired) > 0.99999);
        assert!((q * Vec3::X).distance(Vec3::X) < 1e-6);
        for _ in 0..100 {
            assert_eq!(hinge_rotation(frame, &a).unwrap(), q);
        }
        assert!(
            hinge_rotation(
                Quat::IDENTITY,
                &aim([1., 0., 0.], [0., 1., 0.], [1., 0., 0.])
            )
            .unwrap()
            .is_finite()
        );
    }

    #[test]
    fn nested_nodes_update_in_one_frame_and_clear_restores_bind_pose() {
        use crate::{AssetDescriptor, AssetKind, Core, SessionPermissions, VisualSpec};
        use std::sync::{Arc, Mutex};
        let mut core = Core::default();
        core.open_session_with_permissions(
            "s",
            "p",
            SessionPermissions {
                visual_control: true,
                ..default()
            },
        )
        .unwrap();
        core.register_object("s", "craft").unwrap();
        core.register_asset(
            "model",
            AssetDescriptor {
                kind: AssetKind::Model,
                path: "models/rig.glb".into(),
            },
        )
        .unwrap();
        core.set_visual(
            "s",
            "p",
            "craft",
            Some(VisualSpec::Model {
                asset_id: "model".into(),
                scene: 0,
                scale_km_per_unit: 1.,
                framing_radius_km: None,
            }),
        )
        .unwrap();
        let revision = core.visual_assignment("craft").unwrap().revision;
        let shared = Arc::new(Mutex::new(core));
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<JointRenderState>()
            .add_systems(Update, apply_model_joints);
        let frame =
            Quat::from_rotation_x(-std::f32::consts::FRAC_PI_2) * Quat::from_rotation_z(0.6);
        let root = app
            .world_mut()
            .spawn((
                VisualRoot::joint_fixture("craft", revision),
                Transform::from_rotation(frame),
            ))
            .id();
        let bind = Transform::from_xyz(1., 2., 3.)
            .with_rotation(Quat::from_rotation_x(0.17))
            .with_scale(Vec3::splat(0.1));
        let truss = app
            .world_mut()
            .spawn((Name::new("truss joint"), bind, ChildOf(root)))
            .id();
        let wing = app
            .world_mut()
            .spawn((Name::new("panel"), bind, ChildOf(truss)))
            .id();
        let mut outer = aim([1., 0., 0.], [0., 0., 1.], [0., 1., 0.]);
        outer.joint = "truss_joint".into();
        let inner = aim([0., 1., 0.], [1., 0., 0.], [0., 1., 0.]);
        let mut missing = inner.clone();
        missing.joint = "absent".into();
        // Deliberately reverse declaration order: parent hierarchy decides execution.
        shared
            .lock()
            .unwrap()
            .set_model_joints("s", "p", "craft", vec![inner.clone(), outer, missing])
            .unwrap();
        app.update();
        let truss_q = app.world().get::<Transform>(truss).unwrap().rotation;
        let wing_t = app.world().get::<Transform>(wing).unwrap();
        let parent = frame * truss_q;
        let hinge = parent * Vec3::Y;
        let target = Vec3::NEG_Z;
        let projected = (target - hinge * target.dot(hinge)).normalize();
        assert!((parent * wing_t.rotation * Vec3::X).dot(projected) > 0.99999);
        assert_eq!(wing_t.translation, bind.translation);
        assert_eq!(wing_t.scale, bind.scale);
        let pose = wing_t.rotation;
        for _ in 0..5 {
            app.update();
            assert_eq!(app.world().get::<Transform>(wing).unwrap().rotation, pose);
        }
        let status = shared.lock().unwrap().model_joint_status("craft");
        assert_eq!(status["phase"], "partial");
        assert_eq!(status["applied"].as_array().unwrap().len(), 2);
        assert_eq!(status["missing"][0], "absent");
        shared
            .lock()
            .unwrap()
            .set_model_joints("s", "p", "craft", vec![inner.clone()])
            .unwrap();
        app.update();
        let parent_after_clear = frame * bind.rotation;
        let h = parent_after_clear * Vec3::Y;
        let projected = (Vec3::NEG_Z - h * Vec3::NEG_Z.dot(h)).normalize();
        let actual =
            parent_after_clear * app.world().get::<Transform>(wing).unwrap().rotation * Vec3::X;
        assert!(
            actual.dot(projected) > 0.99999,
            "inner joint must use the restored parent in the same frame"
        );
        shared
            .lock()
            .unwrap()
            .set_model_joints("s", "p", "craft", vec![])
            .unwrap();
        app.update();
        assert_eq!(
            app.world().get::<Transform>(wing).unwrap().rotation,
            bind.rotation
        );
        assert_eq!(
            app.world().get::<Transform>(truss).unwrap().rotation,
            bind.rotation
        );
        assert!(
            app.world()
                .resource::<JointRenderState>()
                .originals
                .is_empty()
        );
        // Ambiguous names must not silently animate an arbitrary mesh.
        app.world_mut()
            .spawn((Name::new("panel"), Transform::default(), ChildOf(root)));
        shared
            .lock()
            .unwrap()
            .set_model_joints("s", "p", "craft", vec![inner.clone()])
            .unwrap();
        app.update();
        assert_eq!(
            shared.lock().unwrap().model_joint_status("craft")["ambiguous"][0],
            "panel"
        );
        let newer = revision + 1;
        app.world_mut()
            .get_mut::<VisualRoot>(root)
            .unwrap()
            .revision = newer;
        // A mismatching visual revision remains inactive and releases bindings.
        shared
            .lock()
            .unwrap()
            .set_model_joints("s", "p", "craft", vec![inner])
            .unwrap();
        app.update();
        assert!(app.world().resource::<JointRenderState>().rigs.is_empty());
    }
}
