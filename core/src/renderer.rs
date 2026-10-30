//! Built-in Bevy rendering with resources resolved through the host catalog.
use crate::render_assets::{SharedVisuals, attach_visuals, poll_visuals, world_ready};
use crate::runtime::SceneObject;
use crate::runtime::{CoreScenePlugin, CoreStore, DisplaySettings, sync_scene};
use crate::{SharedCore, VisualPhase, VisualSpec};
use bevy::asset::AssetMetaCheck;
use bevy::camera::primitives::Aabb;
use bevy::input::mouse::{AccumulatedMouseMotion, MouseScrollUnit, MouseWheel};
use bevy::math::DVec3;
use bevy::prelude::*;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

#[derive(Resource)]
struct RendererStop(Arc<AtomicBool>);
#[derive(Component)]
struct DisplayCamera;
type FramingNodes<'w, 's> = Query<
    'w,
    's,
    (
        &'static Transform,
        Option<&'static Children>,
        Option<&'static Aabb>,
    ),
    Without<DisplayCamera>,
>;
#[derive(Resource)]
struct OrbitView {
    target: Option<String>,
    focus_revision: u64,
    yaw: f32,
    pitch: f32,
    distance: f32,
}
impl Default for OrbitView {
    fn default() -> Self {
        Self {
            target: None,
            focus_revision: 0,
            yaw: 0.0,
            pitch: 0.0,
            distance: 4.0,
        }
    }
}

pub(crate) fn create_browser_app(core: SharedCore, stop: Arc<AtomicBool>, canvas: &str) -> App {
    let mut app = App::new();
    app.insert_resource(ClearColor(Color::srgb(
        13.0 / 255.0,
        23.0 / 255.0,
        33.0 / 255.0,
    )));
    app.add_plugins(
        DefaultPlugins
            .set(AssetPlugin {
                // Host catalogs contain source assets, not Bevy processor sidecars.
                meta_check: AssetMetaCheck::Never,
                ..default()
            })
            .set(WindowPlugin {
                primary_window: Some(Window {
                    title: "SpaceEyes — Solar System".into(),
                    canvas: Some(canvas.into()),
                    fit_canvas_to_parent: true,
                    ..default()
                }),
                ..default()
            }),
    )
    .add_plugins(CoreScenePlugin(core))
    .insert_resource(RendererStop(stop))
    .init_resource::<OrbitView>()
    .init_resource::<crate::face_texture::FaceCache>()
    .add_systems(Startup, setup)
    .add_systems(
        Update,
        (orbit_input, update_focus).chain().before(sync_scene),
    )
    .add_systems(
        Update,
        (
            attach_visuals,
            poll_visuals,
            crate::face_texture::resolve_faces,
            crate::ring_texture::resolve_rings,
        )
            .chain()
            .after(sync_scene),
    )
    .add_observer(world_ready)
    .add_systems(Update, stop_renderer)
    .add_systems(
        PostUpdate,
        draw_annotations.after(bevy::transform::TransformSystems::Propagate),
    );
    app
}

fn setup(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>) {
    commands.insert_resource(SharedVisuals {
        mesh: meshes.add(Sphere::new(1.0).mesh().uv(128, 64)),
    });
    commands.spawn((
        Camera3d::default(),
        // Analytic tonemapping keeps render lookup images out of the executable.
        bevy::core_pipeline::tonemapping::Tonemapping::KhronosPbrNeutral,
        DisplayCamera,
        Transform::from_xyz(0.0, 0.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 10_000.0,
            shadow_maps_enabled: true,
            ..default()
        },
        Transform::from_xyz(4.0, 4.0, 8.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
}

#[derive(Default)]
struct CameraBlend {
    key: Option<String>,
    start_km: DVec3,
    start_rotation: Quat,
    elapsed: f32,
}
impl CameraBlend {
    #[allow(clippy::too_many_arguments)]
    fn apply(
        &mut self,
        key: &str,
        previous: Transform,
        desired: Transform,
        old: &DisplaySettings,
        new: &DisplaySettings,
        delta: Option<f32>,
    ) -> Transform {
        let changed = self.key.as_deref() != Some(key);
        if changed {
            let was_initialized = self.key.is_some();
            self.key = Some(key.to_owned());
            let local = previous.translation.as_dvec3() / old.units_per_km;
            self.start_km = old.origin_km + DVec3::new(local.x, -local.z, local.y);
            self.start_rotation = previous.rotation;
            self.elapsed = if was_initialized && delta.is_some() {
                0.0
            } else {
                0.35
            };
        }
        if self.elapsed >= 0.35 {
            return desired;
        }
        self.elapsed = (self.elapsed + delta.unwrap_or(0.35).max(0.0)).min(0.35);
        let t = self.elapsed / 0.35;
        let t = t * t * (3.0 - 2.0 * t);
        // Reproject the old physical camera position using the NEW origin and scale.
        let start = (self.start_km - new.origin_km) * new.units_per_km;
        let start = DVec3::new(start.x, start.z, -start.y).as_vec3();
        if !start.is_finite() {
            return desired;
        }
        Transform {
            translation: start.lerp(desired.translation, t),
            rotation: self.start_rotation.slerp(desired.rotation, t),
            ..desired
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn update_focus(
    store: Res<CoreStore>,
    mut settings: ResMut<DisplaySettings>,
    mut orbit: ResMut<OrbitView>,
    mut camera: Query<(&mut Transform, &mut Projection), With<DisplayCamera>>,
    objects: Query<(Entity, &SceneObject)>,
    nodes: FramingNodes,
    time: Option<Res<Time>>,
    mut blend: Local<CameraBlend>,
) {
    let Ok(core) = store.0.lock() else {
        return;
    };
    let old_settings = settings.clone();
    let key = format!(
        "{}:{}:{}",
        core.focused_object().unwrap_or("overview"),
        core.camera_view(),
        core.focus_revision()
    );
    let view_changed = blend.key.as_deref() != Some(key.as_str());
    let delta = time.as_ref().map(|time| time.delta_secs());
    if core.focused_object().is_none() {
        let mut min = DVec3::splat(f64::INFINITY);
        let mut max = DVec3::splat(f64::NEG_INFINITY);
        for id in core.object_ids() {
            if let Ok(state) = core.object_state_at(id, core.clock().epoch()) {
                let p = DVec3::from_array(state.position_km);
                let extent = core
                    .visual_assignment(id)
                    .and_then(|v| match v.spec {
                        VisualSpec::Sphere {
                            ring_outer_radius_ratio,
                            ..
                        } => ring_outer_radius_ratio,
                        _ => None,
                    })
                    .unwrap_or(1.0)
                    * state.radius_km;
                min = min.min(p - DVec3::splat(extent));
                max = max.max(p + DVec3::splat(extent));
            }
        }
        if !min.is_finite() || !max.is_finite() {
            return;
        }
        settings.origin_km = min * 0.5 + max * 0.5;
        let radius = ((max - min).length() * 0.5).max(1e-12);
        settings.units_per_km = radius.recip();
        if orbit.target.is_some() {
            *orbit = OrbitView::default();
        }
        if view_changed {
            match core.camera_view() {
                "top" => {
                    orbit.pitch = -1.5;
                    orbit.yaw = 0.0;
                }
                "front" => {
                    orbit.pitch = 0.0;
                    orbit.yaw = 0.0;
                }
                "side" => {
                    orbit.pitch = 0.0;
                    orbit.yaw = std::f32::consts::FRAC_PI_2;
                }
                _ => {}
            }
        }
        for (mut transform, mut projection) in &mut camera {
            let mut distance = orbit.distance;
            if let Projection::Perspective(p) = &mut *projection {
                p.near = (distance * 0.001).clamp(1e-12, 0.001);
                let half_fov = (p.fov * 0.5)
                    .tan()
                    .min((p.fov * 0.5).tan() * p.aspect_ratio)
                    .atan();
                if view_changed {
                    distance = distance.max(1.1 / half_fov.sin());
                }
                orbit.distance = distance;
                p.far = 10000.0;
            }
            let position = Quat::from_rotation_y(orbit.yaw)
                * Quat::from_rotation_x(orbit.pitch)
                * Vec3::new(0.0, 0.0, distance);
            let desired = Transform::from_translation(position).looking_at(Vec3::ZERO, Vec3::Y);
            *transform = blend.apply(&key, *transform, desired, &old_settings, &settings, delta);
            if let Projection::Perspective(p) = &mut *projection {
                p.far = p.far.max(transform.translation.length() * 2.0);
            }
        }
        return;
    }
    let Some(id) = core.focused_object() else {
        return;
    };
    let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
        return;
    };
    settings.origin_km = DVec3::from_array(state.position_km);
    settings.units_per_km = 1.0 / state.radius_km;
    if orbit.target.as_deref() != Some(id) || orbit.focus_revision != core.focus_revision() {
        *orbit = OrbitView {
            target: Some(id.to_owned()),
            focus_revision: core.focus_revision(),
            ..default()
        };
    }
    let mut center = Vec3::ZERO;
    let mut radius = core
        .visual_assignment(id)
        .and_then(|v| match v.spec {
            VisualSpec::Sphere {
                ring_outer_radius_ratio,
                ..
            } => ring_outer_radius_ratio.map(|r| r as f32),
            _ => None,
        })
        .unwrap_or(1.0);
    if let Some(assignment) = core.visual_assignment(id)
        && let VisualSpec::Model {
            scale_km_per_unit, ..
        } = assignment.spec
        && core.visual_status(id).ok().flatten().is_some_and(|status| {
            status.revision == assignment.revision && status.phase == VisualPhase::Ready
        })
        && let Some((entity, _)) = objects.iter().find(|(_, object)| object.id == id)
        && let Ok((_, Some(children), _)) = nodes.get(entity)
    {
        let scale = (scale_km_per_unit * settings.units_per_km) as f32;
        let mut stack: Vec<_> = children
            .iter()
            .map(|child| {
                (
                    child,
                    Mat4::from_scale_rotation_translation(
                        Vec3::splat(scale),
                        crate::runtime::display_rotation(state.orientation_wxyz),
                        Vec3::ZERO,
                    ),
                )
            })
            .collect();
        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);
        while let Some((entity, parent)) = stack.pop() {
            let Ok((transform, children, bounds)) = nodes.get(entity) else {
                continue;
            };
            let matrix = parent * transform.to_matrix();
            if let Some(bounds) = bounds {
                let (lo, hi) = transformed_bounds(bounds, matrix);
                min = min.min(lo);
                max = max.max(hi);
            }
            if let Some(children) = children {
                stack.extend(children.iter().map(|child| (child, matrix)));
            }
        }
        if min.is_finite() && max.is_finite() {
            center = (min + max) * 0.5;
            radius = ((max - min).length() * 0.5).max(1e-7);
        }
    }
    for (mut transform, mut projection) in &mut camera {
        let is_model = core
            .visual_assignment(id)
            .is_some_and(|v| matches!(v.spec, VisualSpec::Model { .. }));
        let surface = if is_model { radius } else { 1.0 };
        let mut distance = orbit.distance.max(surface * 1.0001 / radius);
        orbit.distance = distance;
        if let Projection::Perspective(p) = &mut *projection {
            p.near = ((distance * radius - surface) * 0.1).clamp(1e-9, (radius * 0.01).max(1e-9));
            p.far = (radius * 10000.0).max(p.near * 100.0);
            let half_fov = (p.fov * 0.5)
                .tan()
                .min((p.fov * 0.5).tan() * p.aspect_ratio)
                .atan();
            if view_changed {
                distance = distance.max(1.1 / half_fov.sin());
            }
            orbit.distance = distance;
        }
        if view_changed {
            match core.camera_view() {
                "top" => {
                    orbit.pitch = -1.5;
                    orbit.yaw = 0.0;
                }
                "front" => {
                    orbit.pitch = 0.0;
                    orbit.yaw = 0.0;
                }
                "side" => {
                    orbit.pitch = 0.0;
                    orbit.yaw = std::f32::consts::FRAC_PI_2;
                }
                _ => {}
            }
        }
        let position = Quat::from_rotation_y(orbit.yaw)
            * Quat::from_rotation_x(orbit.pitch)
            * Vec3::new(0.0, 0.0, distance * radius);
        let desired = Transform::from_translation(center + position).looking_at(center, Vec3::Y);
        *transform = blend.apply(&key, *transform, desired, &old_settings, &settings, delta);
        if let Projection::Perspective(p) = &mut *projection {
            p.far = p.far.max(transform.translation.length() * 2.0);
        }
    }
}

fn orbit_input(
    buttons: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    mut wheel: MessageReader<MouseWheel>,
    mut orbit: ResMut<OrbitView>,
) {
    if buttons.pressed(MouseButton::Left) {
        orbit.yaw -= motion.delta.x * 0.005;
        orbit.pitch = (orbit.pitch - motion.delta.y * 0.005).clamp(-1.5, 1.5);
    }
    for event in wheel.read() {
        let amount = match event.unit {
            MouseScrollUnit::Line => event.y,
            MouseScrollUnit::Pixel => event.y * 0.01,
        };
        orbit.distance = (orbit.distance * (-amount * 0.1).exp()).clamp(1e-8, 1000.0);
    }
}

fn stop_renderer(stop: Res<RendererStop>, mut exit: MessageWriter<AppExit>) {
    if stop.0.load(Ordering::Acquire) {
        exit.write(AppExit::Success);
    }
}

#[cfg(test)]
mod framing_tests {
    use super::*;
    #[test]
    fn transformed_bounds_include_offset_rotation_and_scale() {
        let bounds = Aabb::from_min_max(Vec3::new(2.0, -1.0, -1.0), Vec3::new(4.0, 1.0, 1.0));
        let matrix = Mat4::from_scale_rotation_translation(
            Vec3::splat(2.0),
            Quat::from_rotation_z(std::f32::consts::FRAC_PI_2),
            Vec3::X,
        );
        let (min, max) = transformed_bounds(&bounds, matrix);
        assert!(((min + max) * 0.5 - Vec3::new(1.0, 6.0, 0.0)).length() < 1e-5);
        assert!((max - min - Vec3::splat(4.0)).length() < 1e-5);
    }
}

fn transformed_bounds(bounds: &Aabb, matrix: Mat4) -> (Vec3, Vec3) {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for x in [-1.0, 1.0] {
        for y in [-1.0, 1.0] {
            for z in [-1.0, 1.0] {
                let point = matrix.transform_point3(
                    Vec3::from(bounds.center)
                        + Vec3::from(bounds.half_extents) * Vec3::new(x, y, z),
                );
                min = min.min(point);
                max = max.max(point);
            }
        }
    }
    (min, max)
}
#[cfg(test)]
mod camera_lifecycle_tests {
    use super::*;
    use crate::{AssetDescriptor, AssetKind, Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn replacement_and_target_switch_reframe_without_changing_scientific_radius() {
        let shared = Arc::new(Mutex::new(Core::default()));
        {
            let mut core = shared.lock().unwrap();
            core.open_session_with_permissions(
                "s",
                "p",
                SessionPermissions {
                    camera_control: true,
                    visual_control: true,
                    ..default()
                },
            )
            .unwrap();
            for id in ["body:a", "body:b"] {
                core.register_object("s", id).unwrap();
                core.set_object_state(
                    "s",
                    id,
                    ObjectState {
                        orientation_wxyz: None,
                        position_km: [0.0; 3],
                        radius_km: 2.0,
                        epoch_tdb_seconds: 0.0,
                        coverage_tdb_seconds: [0.0, 10.0],
                        frame: "ICRF".into(),
                        source: "test".into(),
                    },
                )
                .unwrap();
            }
            core.register_asset(
                "model:a",
                AssetDescriptor {
                    kind: AssetKind::Model,
                    path: "a.glb".into(),
                },
            )
            .unwrap();
            core.set_visual(
                "s",
                "p",
                "body:a",
                Some(VisualSpec::Model {
                    asset_id: "model:a".into(),
                    scene: 0,
                    scale_km_per_unit: 0.002,
                }),
            )
            .unwrap();
            let revision = core.visual_assignment("body:a").unwrap().revision;
            core.record_visual_status("body:a", revision, VisualPhase::Ready, None);
            core.focus("s", "p", "body:a").unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .init_resource::<crate::face_texture::FaceCache>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        let object = app
            .world_mut()
            .spawn((
                SceneObject {
                    id: "body:a".into(),
                },
                Transform::default(),
            ))
            .id();
        let mesh = app
            .world_mut()
            .spawn((
                Transform::from_xyz(3.0, 0.0, 0.0),
                Aabb::from_min_max(-Vec3::ONE, Vec3::ONE),
                ChildOf(object),
            ))
            .id();
        app.update();
        let first = app.world().get::<Transform>(camera).unwrap().translation;
        assert!((first.x - 0.003).abs() < 1e-6);
        // Update this same focused object's scientific pose, without a focus command
        // or relying on a root Transform from the previous sync_scene frame.
        {
            let mut core = shared.lock().unwrap();
            let mut sample = core.object_state_at("body:a", 0.).unwrap().clone();
            let half = std::f64::consts::FRAC_1_SQRT_2;
            sample.orientation_wxyz = Some([half, 0., 0., half]);
            core.set_object_state("s", "body:a", sample).unwrap();
        }
        app.update();
        let rotated = app.world().get::<Transform>(camera).unwrap().translation;
        // Scientific +Z quarter-turn becomes display +Y quarter-turn:
        // the offset model center moves from (.003,0,0) to (0,0,-.003).
        assert!(rotated.x.abs() < 1e-6);
        assert!((rotated.z - (first.z - 0.003)).abs() < 1e-6);
        {
            let mut core = shared.lock().unwrap();
            let mut sample = core.object_state_at("body:a", 0.).unwrap().clone();
            sample.orientation_wxyz = None;
            core.set_object_state("s", "body:a", sample).unwrap();
        }
        app.update();
        {
            let mut core = shared.lock().unwrap();
            core.set_visual(
                "s",
                "p",
                "body:a",
                Some(VisualSpec::Model {
                    asset_id: "model:a".into(),
                    scene: 0,
                    scale_km_per_unit: 0.002,
                }),
            )
            .unwrap();
        }
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            Vec3::new(0.0, 0.0, 4.0)
        );
        {
            let mut core = shared.lock().unwrap();
            let revision = core.visual_assignment("body:a").unwrap().revision;
            core.record_visual_status("body:a", revision, VisualPhase::Ready, None);
        }
        app.world_mut()
            .entity_mut(mesh)
            .insert(Transform::from_xyz(6.0, 0.0, 0.0).with_scale(Vec3::splat(2.0)));
        app.update();
        let replacement = app.world().get::<Transform>(camera).unwrap().translation;
        assert!((replacement.x - 0.006).abs() < 1e-6);
        assert!((replacement.z / first.z - 2.0).abs() < 1e-5);
        shared.lock().unwrap().focus("s", "p", "body:b").unwrap();
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            Vec3::new(0.0, 0.0, 4.0)
        );
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .object_state_at("body:a", 0.0)
                .unwrap()
                .radius_km,
            2.0
        );
    }
}

#[derive(Component)]
struct AnnotationLabel {
    object: String,
}
type AnnotationLabels<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        &'static AnnotationLabel,
        &'static mut Text,
        &'static mut Node,
    ),
>;
fn maintain_labels(
    commands: &mut Commands,
    labels: &mut AnnotationLabels,
    desired: Vec<(String, String, Vec2)>,
    font: Handle<Font>,
) {
    let mut desired: std::collections::HashMap<_, _> = desired
        .into_iter()
        .map(|(id, text, pixel)| (id, (text, pixel)))
        .collect();
    for (entity, label, mut text, mut node) in labels.iter_mut() {
        if let Some((value, pixel)) = desired.remove(&label.object) {
            if text.0 != value {
                text.0 = value;
            }
            node.left = Val::Px(pixel.x + 8.0);
            node.top = Val::Px(pixel.y - 8.0);
        } else {
            commands.entity(entity).despawn();
        }
    }
    for (object, (text, pixel)) in desired {
        commands.spawn((
            AnnotationLabel { object },
            Text::new(text),
            TextFont {
                font: FontSource::Handle(font.clone()),
                font_size: FontSize::Px(14.0),
                ..default()
            },
            TextColor(Color::WHITE),
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(pixel.x + 8.0),
                top: Val::Px(pixel.y - 8.0),
                ..default()
            },
        ));
    }
}
#[allow(clippy::too_many_arguments)]
fn draw_annotations(
    mut commands: Commands,
    store: Res<CoreStore>,
    settings: Res<DisplaySettings>,
    mut gizmos: Gizmos,
    mut labels: AnnotationLabels,
    assets: Res<AssetServer>,
    mut label_font: Local<Option<Handle<Font>>>,
    camera: Query<(&Camera, &GlobalTransform), With<DisplayCamera>>,
) {
    let mut desired_labels = Vec::new();
    let Ok(core) = store.0.lock() else {
        maintain_labels(&mut commands, &mut labels, Vec::new(), Handle::default());
        return;
    };
    let Ok((camera, camera_transform)) = camera.single() else {
        maintain_labels(&mut commands, &mut labels, Vec::new(), Handle::default());
        return;
    };
    let to_display = |p: [f64; 3]| {
        let p = (DVec3::from_array(p) - settings.origin_km) * settings.units_per_km;
        Vec3::new(p.x as f32, p.z as f32, -p.y as f32)
    };
    for (id, label, points) in core.annotations() {
        if core.object_state_at(id, core.clock().epoch()).is_err() {
            continue;
        }
        if let Some(points) = points {
            for pair in points.windows(2) {
                let a = to_display(pair[0]);
                let b = to_display(pair[1]);
                if a.is_finite() && b.is_finite() {
                    gizmos.line(a, b, Color::srgb(0.3, 0.65, 0.95));
                }
            }
        }
        if let Some(text) = label.filter(|text| !text.is_empty()) {
            let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
                continue;
            };
            let position = to_display(state.position_km);
            if let Ok(pixel) = camera.world_to_viewport(camera_transform, position) {
                desired_labels.push((id.to_owned(), text.to_owned(), pixel));
            }
        }
    }
    let font = if desired_labels.is_empty() {
        label_font.clone().unwrap_or_default()
    } else {
        label_font
            .get_or_insert_with(|| assets.load("fonts/FiraMono-subset.ttf"))
            .clone()
    };
    maintain_labels(&mut commands, &mut labels, desired_labels, font);
}

#[cfg(test)]
mod blend_tests {
    use super::*;
    #[test]
    fn switching_origin_reprojects_previous_camera_then_locks_without_follow_lag() {
        let old = DisplaySettings::new([1e12, 0., 0.], 0.5).unwrap();
        let new = DisplaySettings::new([1e12 + 1000., 0., 0.], 0.25).unwrap();
        let previous = Transform::from_xyz(4., 0., 0.);
        let desired = Transform::from_xyz(0., 0., 4.);
        let mut blend = CameraBlend::default();
        assert_eq!(
            blend
                .apply("a", previous, previous, &old, &old, Some(0.01))
                .translation,
            previous.translation
        );
        let first = blend.apply("b", previous, desired, &old, &new, Some(0.));
        // Physical X was 1e12+8 km, so new local X is (8-1000)*0.25.
        assert!((first.translation.x + 248.).abs() < 1e-5);
        let final_pose = blend.apply("b", first, desired, &new, &new, Some(0.35));
        assert_eq!(final_pose.translation, desired.translation);
        let moved = Transform::from_xyz(0., 0., 7.);
        assert_eq!(
            blend
                .apply("b", final_pose, moved, &new, &new, Some(0.01))
                .translation,
            moved.translation
        );
    }
}

#[cfg(test)]
mod preset_input_tests {
    use super::*;
    use crate::{Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn preset_allows_next_frame_drag_in_overview_and_focus() {
        for focus in [false, true] {
            for mode in ["top", "front", "side"] {
                let shared = Arc::new(Mutex::new(Core::default()));
                {
                    let mut c = shared.lock().unwrap();
                    c.open_session_with_permissions(
                        "s",
                        "p",
                        SessionPermissions {
                            camera_control: true,
                            ..default()
                        },
                    )
                    .unwrap();
                    c.register_object("s", "earth").unwrap();
                    c.set_object_state(
                        "s",
                        "earth",
                        ObjectState {
                            orientation_wxyz: None,
                            position_km: [0.; 3],
                            radius_km: 1.,
                            epoch_tdb_seconds: 0.,
                            coverage_tdb_seconds: [0., 1.],
                            frame: "ICRF".into(),
                            source: "test".into(),
                        },
                    )
                    .unwrap();
                    if focus {
                        c.focus("s", "p", "earth").unwrap();
                    }
                    c.set_camera_view("s", "p", mode).unwrap();
                }
                let mut app = App::new();
                app.insert_resource(CoreStore(shared))
                    .init_resource::<DisplaySettings>()
                    .init_resource::<OrbitView>()
                    .add_systems(Update, update_focus);
                let camera = app
                    .world_mut()
                    .spawn((DisplayCamera, Transform::default(), Projection::default()))
                    .id();
                app.update();
                let before = app.world().get::<Transform>(camera).unwrap().translation;
                // orbit_input writes these same angles before update_focus.
                {
                    let mut orbit = app.world_mut().resource_mut::<OrbitView>();
                    orbit.yaw += 0.2;
                    orbit.pitch += 0.1;
                }
                app.update();
                let after = app.world().get::<Transform>(camera).unwrap().translation;
                assert!(
                    before.distance(after) > 0.01,
                    "preset {mode}, focus={focus} overwrote drag"
                );
            }
        }
    }
}

#[cfg(test)]
mod label_persistence_tests {
    use super::*;
    #[derive(Resource, Default)]
    struct DesiredLabels(Vec<(String, String, Vec2)>);
    fn update_labels(
        mut commands: Commands,
        mut labels: AnnotationLabels,
        desired: Res<DesiredLabels>,
    ) {
        maintain_labels(
            &mut commands,
            &mut labels,
            desired.0.clone(),
            Handle::default(),
        );
    }
    #[test]
    fn label_entities_survive_frames_and_are_removed_only_when_absent() {
        let mut app = App::new();
        app.init_resource::<DesiredLabels>()
            .add_systems(Update, update_labels);
        app.world_mut().resource_mut::<DesiredLabels>().0 =
            vec![("earth".into(), "EARTH".into(), Vec2::ZERO)];
        app.update();
        let entity = app
            .world_mut()
            .query_filtered::<Entity, With<AnnotationLabel>>()
            .single(app.world())
            .unwrap();
        app.world_mut().resource_mut::<DesiredLabels>().0 =
            vec![("earth".into(), "EARTH updated".into(), Vec2::splat(10.))];
        app.update();
        assert!(app.world().get::<AnnotationLabel>(entity).is_some());
        assert_eq!(app.world().get::<Text>(entity).unwrap().0, "EARTH updated");
        assert_eq!(app.world().get::<Node>(entity).unwrap().left, Val::Px(18.));
        app.world_mut().resource_mut::<DesiredLabels>().0.clear();
        app.update();
        assert!(app.world().get::<AnnotationLabel>(entity).is_none());
    }
}

#[cfg(test)]
mod repeated_focus_tests {
    use super::*;
    use crate::{Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn explicit_focus_of_same_target_restores_framing() {
        let shared = Arc::new(Mutex::new(Core::default()));
        {
            let mut c = shared.lock().unwrap();
            c.open_session_with_permissions(
                "s",
                "p",
                SessionPermissions {
                    camera_control: true,
                    ..default()
                },
            )
            .unwrap();
            c.register_object("s", "earth").unwrap();
            c.set_object_state(
                "s",
                "earth",
                ObjectState {
                    orientation_wxyz: None,
                    position_km: [1e12, 0., 0.],
                    radius_km: 1.,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    frame: "ICRF".into(),
                    source: "test".into(),
                },
            )
            .unwrap();
            c.focus("s", "p", "earth").unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        app.update();
        let framed = app.world().get::<Transform>(camera).unwrap().translation;
        app.world_mut().resource_mut::<OrbitView>().distance = 1.05;
        app.update();
        assert!(
            (app.world()
                .get::<Transform>(camera)
                .unwrap()
                .translation
                .length()
                - 1.05)
                .abs()
                < 1e-4,
            "manual zoom was clamped back to full-object framing"
        );
        {
            let mut view = app.world_mut().resource_mut::<OrbitView>();
            view.yaw = 1.;
            view.distance = 20.;
        }
        app.update();
        assert!(
            app.world()
                .get::<Transform>(camera)
                .unwrap()
                .translation
                .distance(framed)
                > 1.
        );
        shared.lock().unwrap().focus("s", "p", "earth").unwrap();
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            framed
        );
        assert_eq!(app.world().resource::<DisplaySettings>().origin_km.x, 1e12);
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .object_state_at("earth", 0.)
                .unwrap()
                .radius_km,
            1.
        );
    }
}
