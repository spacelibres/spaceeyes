//! Built-in Bevy rendering with resources resolved through the host catalog.
use crate::picking::{PickFrame, PickShape, PickTarget, SharedPickFrame};
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
#[derive(Resource)]
struct RendererPicks(SharedPickFrame);
#[derive(Component)]
pub(crate) struct DisplayCamera;
// IAU 2012 B1: one astronomical unit is exactly 149597870700 metres.
const AU_KM: f64 = 149_597_870.7;
#[derive(Component)]
struct BodyMarker {
    key: String,
}
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
    motion: crate::camera_motion::Motion,
    input_active: bool,
    target: Option<String>,
    focus_revision: u64,
    yaw: f32,
    pitch: f32,
    distance: f32,
}
impl Default for OrbitView {
    fn default() -> Self {
        Self {
            motion: crate::camera_motion::Motion::default(),
            input_active: false,
            target: None,
            focus_revision: 0,
            yaw: 0.0,
            pitch: 0.0,
            distance: 4.0,
        }
    }
}

pub(crate) fn create_browser_app(
    core: SharedCore,
    stop: Arc<AtomicBool>,
    canvas: &str,
    picks: SharedPickFrame,
) -> App {
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
    .insert_resource(bevy::winit::WinitSettings {
        // Animation needs a bounded cadence; do not saturate high-refresh displays.
        focused_mode: bevy::winit::UpdateMode::reactive_low_power(
            std::time::Duration::from_secs_f64(1. / 30.),
        ),
        unfocused_mode: bevy::winit::UpdateMode::reactive_low_power(
            std::time::Duration::from_secs_f64(1. / 5.),
        ),
    })
    .add_plugins(CoreScenePlugin(core))
    .add_plugins(MaterialPlugin::<crate::ring_texture::RingMaterial>::default())
    .add_plugins(MaterialPlugin::<crate::sky_render::SkyMaterial>::default())
    .add_plugins((
        MaterialPlugin::<crate::deep_render::GalaxyMaterial>::default(),
        MaterialPlugin::<crate::solar_surface::SolarSurfaceMaterial>::default(),
        MaterialPlugin::<crate::stellar_render::StellarMaterial>::default(),
        MaterialPlugin::<crate::stellar_render::ProminenceMaterial>::default(),
    ))
    .add_systems(Update, crate::deep_render::sync_environment)
    .add_systems(Update, crate::sky_render::sync_sky.after(sync_scene))
    .insert_resource(RendererStop(stop))
    .insert_resource(RendererPicks(picks))
    .init_resource::<crate::solar_surface::SolarSurfaceLod>()
    .add_systems(
        PostUpdate,
        crate::solar_surface::sync_solar_surface
            .after(crate::stellar_render::sync_stellar_lod)
            .after(bevy::transform::TransformSystems::Propagate),
    )
    .init_resource::<crate::stellar_render::StellarLod>()
    .add_systems(
        PostUpdate,
        crate::stellar_render::sync_stellar_lod.after(bevy::transform::TransformSystems::Propagate),
    )
    .init_resource::<OrbitView>()
    .init_resource::<crate::face_texture::FaceCache>()
    .add_systems(Startup, setup)
    .add_systems(
        Update,
        (orbit_input, update_focus, enforce_camera_collision)
            .chain()
            .before(sync_scene),
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
    .add_systems(Update, update_illumination.after(sync_scene))
    .add_systems(Update, stop_renderer)
    .add_systems(
        PostUpdate,
        draw_annotations
            .after(bevy::transform::TransformSystems::Propagate)
            .after(bevy::camera::CameraUpdateSystems),
    );
    app
}

fn setup(mut commands: Commands, mut meshes: ResMut<Assets<Mesh>>) {
    commands.insert_resource(SharedVisuals {
        mesh: meshes.add(Sphere::new(1.0).mesh().uv(128, 64)),
    });
    commands.spawn((
        Camera3d::default(),
        bevy::camera::Hdr,
        bevy::post_process::bloom::Bloom {
            intensity: 0.12,
            prefilter: bevy::post_process::bloom::BloomPrefilter {
                threshold: 1.0,
                threshold_softness: 0.5,
            },
            ..bevy::post_process::bloom::Bloom::NATURAL
        },
        // Analytic tonemapping keeps render lookup images out of the executable.
        bevy::core_pipeline::tonemapping::Tonemapping::KhronosPbrNeutral,
        DisplayCamera,
        Transform::from_xyz(0.0, 0.0, 4.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        DirectionalLight {
            illuminance: 10_000.0,
            shadow_maps_enabled: false,
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
    let Ok(mut core) = store.0.lock() else {
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
    if view_changed {
        orbit.motion.clear();
    }
    if !view_changed && orbit.input_active {
        blend.elapsed = 0.35;
    }
    let delta = time.as_ref().map(|time| time.delta_secs());
    if core.focused_object().is_none() {
        // The current host's heliocentric scene is centered on its scientific origin.
        let mut radius = 0.0_f64;
        let mut central_surface = 0.0_f64;
        for id in core.object_ids() {
            if let Ok(state) = core.object_state_at(id, core.clock().epoch()) {
                let p = DVec3::from_array(state.position_km);
                if p.length() < state.radius_km {
                    central_surface = central_surface.max(state.radius_km + p.length());
                }
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
                radius = radius.max(p.length() + extent);
            }
        }
        if !radius.is_finite() || radius <= 0. {
            return;
        }
        settings.origin_km = DVec3::ZERO;
        settings.units_per_km = AU_KM.recip();
        let radius_display = (radius / AU_KM) as f32;
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
            let surface = (central_surface / AU_KM) as f32;
            let mut distance = orbit.distance.max(surface * 1.001);
            if let Projection::Perspective(p) = &mut *projection {
                p.near = ((distance - surface) * 0.1).clamp(1e-12, 0.001);
                let half_fov = (p.fov * 0.5)
                    .tan()
                    .min((p.fov * 0.5).tan() * p.aspect_ratio)
                    .atan();
                if view_changed {
                    distance = distance.max(1.1 * radius_display / half_fov.sin());
                }
                orbit.distance = distance;
                p.far = (distance * 2.0).max(10000.0);
            }
            let position = Quat::from_rotation_y(orbit.yaw)
                * Quat::from_rotation_x(orbit.pitch)
                * Vec3::new(0.0, 0.0, distance);
            let desired = Transform::from_translation(position).looking_at(Vec3::ZERO, Vec3::Y);
            *transform = blend
                .apply(&key, *transform, desired, &old_settings, &settings, delta)
                .looking_at(Vec3::ZERO, Vec3::Y);
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
    let distance_km = orbit.distance as f64 * state.radius_km;
    let extent = core
        .object_ids()
        .filter_map(|id| core.object_state_at(id, core.clock().epoch()).ok())
        .map(|s| DVec3::from_array(s.position_km).length() + s.radius_km)
        .fold(0.0_f64, f64::max);
    if !view_changed
        && orbit.target.as_deref() == Some(id)
        && extent > state.radius_km * 100.
        && distance_km > extent * 0.5
    {
        core.camera_zoom_to_overview();
        orbit.target = None;
        orbit.distance = (distance_km / AU_KM) as f32;
        return;
    }
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
            p.far = (radius * 10000.0)
                .max(distance * radius * 2.)
                .max(p.near * 100.0);
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

/// Every current planet representation is solid. A texture mip level is not
/// terrain LOD and grants no traversal capability.
fn enforce_camera_collision(
    store: Res<CoreStore>,
    settings: Res<DisplaySettings>,
    mut cameras: Query<(&mut Transform, &mut Projection), With<DisplayCamera>>,
    mut previous: Local<Option<DVec3>>,
) {
    let Ok(core) = store.0.lock() else {
        return;
    };
    let Ok((mut camera, mut projection)) = cameras.single_mut() else {
        return;
    };
    let scale = settings.units_per_km;
    if !scale.is_finite() || scale <= 0. {
        return;
    }
    let local = camera.translation.as_dvec3() / scale;
    let desired = settings.origin_km + DVec3::new(local.x, -local.z, local.y);
    let solids: Vec<_> = core
        .object_ids()
        .filter_map(|id| core.object_state_at(id, core.clock().epoch()).ok())
        .map(|body| crate::camera_collision::SolidSphere {
            center: DVec3::from_array(body.position_km),
            // Leave room for the f64 -> f32 display projection without
            // changing the object's scientific radius.
            radius: body.radius_km
                + (DVec3::from_array(body.position_km) - settings.origin_km)
                    .abs()
                    .max_element()
                    * f32::EPSILON as f64
                    * 4.,
        })
        .collect();
    let safe = crate::camera_collision::constrain(previous.unwrap_or(desired), desired, &solids);
    *previous = Some(safe);
    if safe.distance_squared(desired) > 1e-18 {
        let local = (safe - settings.origin_km) * scale;
        camera.translation = Vec3::new(local.x as f32, local.z as f32, -local.y as f32);
        let target = core
            .focused_object()
            .and_then(|id| core.object_state_at(id, core.clock().epoch()).ok())
            .map_or(DVec3::ZERO, |body| DVec3::from_array(body.position_km));
        let target = (target - settings.origin_km) * scale;
        camera.look_at(
            Vec3::new(target.x as f32, target.z as f32, -target.y as f32),
            Vec3::Y,
        );
    }
    if let Projection::Perspective(p) = &mut *projection {
        let gap = solids
            .iter()
            .map(|body| (safe.distance(body.center) - body.radius).max(0.))
            .fold(f64::INFINITY, f64::min);
        if gap.is_finite() {
            p.near = p.near.min((gap * scale * 0.25).max(1e-12) as f32);
        }
    }
}

fn orbit_input(
    buttons: Res<ButtonInput<MouseButton>>,
    motion: Res<AccumulatedMouseMotion>,
    mut wheel: MessageReader<MouseWheel>,
    mut orbit: ResMut<OrbitView>,
    time: Res<Time>,
    windows: Query<&Window>,
    mut drag_gate: Local<crate::camera_motion::DragGate>,
) {
    let dt = time.delta_secs();
    let available = !windows
        .iter()
        .any(|w| !w.focused || w.cursor_position().is_none());
    let dragging = drag_gate.accept(
        available,
        buttons.pressed(MouseButton::Left),
        buttons.just_pressed(MouseButton::Left),
    );
    orbit.input_active = dragging;
    if !available {
        orbit.motion.clear();
        wheel.clear();
        return;
    }
    if buttons.just_pressed(MouseButton::Left) {
        orbit.motion.clear();
    }
    let delta = if dragging {
        let delta = [-motion.delta.x * 0.005, -motion.delta.y * 0.005];
        orbit.motion.drag(delta, dt);
        delta
    } else {
        orbit.motion.coast(dt)
    };
    orbit.yaw += delta[0];
    orbit.pitch = (orbit.pitch + delta[1]).clamp(-1.5, 1.5);
    for event in wheel.read() {
        let amount = match event.unit {
            MouseScrollUnit::Line => event.y,
            MouseScrollUnit::Pixel => event.y * 0.01,
        };
        orbit.input_active = true;
        orbit.motion.zoom(-amount * 0.1);
    }
    let zoom = orbit.motion.zoom_step(dt);
    orbit.distance = (orbit.distance * zoom.exp()).clamp(1e-8, 1e12);
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
    fn asymmetric_overview_keeps_scientific_origin_on_camera_axis_after_orbit_and_return() {
        use crate::{Core, ObjectState, SessionPermissions};
        let shared = Arc::new(std::sync::Mutex::new(Core::default()));
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
            for (id, position) in [("sun", [0., 0., 0.]), ("planet", [300., 80., 40.])] {
                c.register_object("s", id).unwrap();
                c.set_object_state(
                    "s",
                    id,
                    ObjectState {
                        position_km: position,
                        radius_km: 1.,
                        epoch_tdb_seconds: 0.,
                        coverage_tdb_seconds: [0., 1.],
                        frame: "ICRF".into(),
                        source: "test".into(),
                        orientation_wxyz: None,
                    },
                )
                .unwrap();
            }
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
        for mode in ["overview", "top", "side", "orbit"] {
            shared
                .lock()
                .unwrap()
                .set_camera_view("s", "p", mode)
                .unwrap();
            app.update();
            assert_eq!(
                app.world().resource::<DisplaySettings>().origin_km,
                DVec3::ZERO
            );
            let transform = app.world().get::<Transform>(camera).unwrap();
            assert!(
                transform
                    .forward()
                    .dot((-transform.translation).normalize())
                    > 0.99999
            );
        }
        // Wheel zoom in overview must never pass through its central physical body.
        for _ in 0..3 {
            app.world_mut().resource_mut::<OrbitView>().distance = 1e-12;
            app.update();
            let transform = app.world().get::<Transform>(camera).unwrap();
            assert!(transform.translation.length() > (1. / AU_KM) as f32);
            let Projection::Perspective(projection) =
                app.world().get::<Projection>(camera).unwrap()
            else {
                panic!("perspective")
            };
            assert!(projection.near < transform.translation.length() - (1. / AU_KM) as f32);
        }
        shared.lock().unwrap().focus("s", "p", "planet").unwrap();
        app.update();
        app.world_mut().resource_mut::<OrbitView>().distance = 1000.;
        app.update();
        assert_eq!(
            shared.lock().unwrap().focused_object(),
            None,
            "wide zoom must release local focus"
        );
        app.update();
        shared
            .lock()
            .unwrap()
            .set_camera_view("s", "p", "overview")
            .unwrap();
        app.update();
        assert_eq!(
            app.world().resource::<DisplaySettings>().origin_km,
            DVec3::ZERO
        );
        assert_eq!(
            app.world().resource::<DisplaySettings>().units_per_km,
            AU_KM.recip()
        );
    }
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

fn stellar_marker_color(color: u32) -> [f32; 4] {
    [
        ((color >> 16) & 255) as f32 / 255.,
        ((color >> 8) & 255) as f32 / 255.,
        (color & 255) as f32 / 255.,
        1.,
    ]
}

#[cfg(test)]
mod solar_marker_tests {
    #[test]
    fn distant_marker_keeps_surface_palette_instead_of_legacy_gold() {
        assert_eq!(
            super::stellar_marker_color(0xff4400),
            [1., 68. / 255., 0., 1.]
        );
        assert_eq!(
            super::stellar_marker_color(0x123456),
            [18. / 255., 52. / 255., 86. / 255., 1.]
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
        Option<&'static bevy::text::TextLayoutInfo>,
    ),
    Without<BodyMarker>,
>;
fn maintain_labels(
    commands: &mut Commands,
    labels: &mut AnnotationLabels,
    desired: Vec<(String, String, Vec2)>,
    font: Handle<Font>,
    opacity: &std::collections::HashMap<String, f32>,
) {
    let mut desired: std::collections::HashMap<_, _> = desired
        .into_iter()
        .map(|(id, text, pixel)| (id, (text, pixel)))
        .collect();
    for (entity, label, mut text, mut node, _) in labels.iter_mut() {
        if let Some((value, pixel)) = desired.remove(&label.object) {
            if text.0 != value {
                text.0 = value;
            }
            node.left = Val::Px(pixel.x + 8.0);
            node.top = Val::Px(pixel.y - 8.0);
            commands.entity(entity).insert(TextColor(Color::srgba(
                1.,
                1.,
                1.,
                opacity.get(&label.object).copied().unwrap_or(1.),
            )));
        } else {
            commands.entity(entity).despawn();
        }
    }
    for (object, (text, pixel)) in desired {
        let alpha = opacity.get(&object).copied().unwrap_or(1.);
        commands.spawn((
            AnnotationLabel { object },
            Text::new(text),
            TextFont {
                font: FontSource::Handle(font.clone()),
                font_size: FontSize::Px(14.0),
                ..default()
            },
            TextColor(Color::srgba(1., 1., 1., alpha)),
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
    picks: Res<RendererPicks>,
    mut gizmos: Gizmos,
    mut labels: AnnotationLabels,
    assets: Res<AssetServer>,
    mut label_font: Local<Option<Handle<Font>>>,
    mut fades: Local<std::collections::HashMap<String, crate::label_visibility::Fade>>,
    time: Res<Time>,
    mut near_focus: Local<bool>,
    mut markers: Query<
        (Entity, &BodyMarker, &mut Node, &mut BackgroundColor),
        Without<AnnotationLabel>,
    >,
    camera: Query<(&Camera, &GlobalTransform), With<DisplayCamera>>,
) {
    if let Ok(mut frame) = picks.0.lock() {
        *frame = PickFrame::default();
    }
    let mut desired_labels = Vec::new();
    let measured: std::collections::HashMap<String, Vec2> = labels
        .iter_mut()
        .filter_map(|(_, label, _, _, layout)| {
            layout
                .filter(|l| l.size.x > 0. && l.size.y > 0.)
                .map(|l| (label.object.clone(), l.size + Vec2::splat(4.)))
        })
        .collect();
    let mut opacity = std::collections::HashMap::new();
    let Ok(core) = store.0.lock() else {
        maintain_labels(
            &mut commands,
            &mut labels,
            Vec::new(),
            Handle::default(),
            &opacity,
        );
        return;
    };
    let Ok((camera, camera_transform)) = camera.single() else {
        maintain_labels(
            &mut commands,
            &mut labels,
            Vec::new(),
            Handle::default(),
            &opacity,
        );
        return;
    };
    let to_display = |p: [f64; 3]| {
        let p = (DVec3::from_array(p) - settings.origin_km) * settings.units_per_km;
        Vec3::new(p.x as f32, p.z as f32, -p.y as f32)
    };
    let viewport = camera.logical_viewport_size().unwrap_or(Vec2::ZERO);
    let c = camera_transform.translation().as_dvec3() / settings.units_per_km;
    let scientific_camera = settings.origin_km + DVec3::new(c.x, -c.z, c.y);
    let spheres: Vec<_> = core
        .object_ids()
        .filter_map(|id| {
            core.object_state_at(id, core.clock().epoch())
                .ok()
                .map(|state| {
                    (
                        id.to_owned(),
                        DVec3::from_array(state.position_km),
                        state.radius_km,
                    )
                })
        })
        .collect();

    let mut pick_frame = PickFrame {
        viewport: viewport.to_array(),
        targets: Vec::new(),
    };
    fades.retain(|id, _| spheres.iter().any(|(body, _, _)| body == id));
    let focus_range = core
        .focused_object()
        .and_then(|id| core.object_state_at(id, core.clock().epoch()).ok())
        .map(|f| {
            let range = scientific_camera
                .distance(DVec3::from_array(f.position_km))
                .max(f.radius_km);
            let angular = f.radius_km / range;
            *near_focus = angular > if *near_focus { 0.018 } else { 0.022 };
            range
        });
    if focus_range.is_none() {
        *near_focus = false;
    }
    let solar_overview =
        crate::label_visibility::solar_overview(core.focused_object(), *near_focus);
    let mut depths = std::collections::HashMap::new();
    let mut marker_nodes = std::collections::HashMap::new();
    for id in core.object_ids() {
        let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
            continue;
        };
        if crate::label_visibility::occluded(
            scientific_camera,
            DVec3::from_array(state.position_km),
            &spheres,
            id,
        ) {
            continue;
        }
        let position = to_display(state.position_km);
        let Ok(pixel) = camera.world_to_viewport(camera_transform, position) else {
            continue;
        };
        let offset =
            position + camera_transform.right() * (state.radius_km * settings.units_per_km) as f32;
        let projected_radius = camera
            .world_to_viewport(camera_transform, offset)
            .map_or(0., |p| p.distance(pixel));
        if !core.visual_status(id).ok().flatten().is_some_and(|status| {
            matches!(status.phase, VisualPhase::Failed | VisualPhase::Suspended)
        }) {
            let depth = camera_transform.translation().distance(position);
            depths.insert(id.to_owned(), depth);
            pick_frame.targets.push(PickTarget {
                id: id.to_owned(),
                depth,
                shape: PickShape::Disc {
                    center: pixel.to_array(),
                    radius: projected_radius.max(12.),
                },
            });
        }
        if pixel.x < 0. || pixel.y < 0. || pixel.x > viewport.x || pixel.y > viewport.y {
            continue;
        }
        if projected_radius >= 6. {
            continue;
        }
        let emissive = core.visual_assignment(id).and_then(|v| match v.spec {
            VisualSpec::Sphere { emissive_rgba, .. } => emissive_rgba,
            _ => None,
        });
        let emissive = emissive.map(|fallback| {
            core.stellar_tuning(id).map_or(fallback, |tuning| {
                stellar_marker_color(tuning.value("surfaceColor") as u32)
            })
        });
        let opacity = ((6. - projected_radius) / 3.).clamp(0., 1.);
        let (size, color) = if let Some(c) = emissive {
            (14., Color::srgba(c[0], c[1], c[2], opacity))
        } else {
            (5., Color::srgba(0.8, 0.88, 0.96, opacity))
        };
        marker_nodes.insert(id.to_owned(), (pixel, size, color));
        if emissive.is_some() {
            marker_nodes.insert(
                format!("{id}:halo"),
                (
                    pixel,
                    30.,
                    Color::srgba(
                        color.to_srgba().red,
                        color.to_srgba().green,
                        color.to_srgba().blue,
                        0.12 * opacity,
                    ),
                ),
            );
        }
    }
    for (entity, marker, mut node, mut color) in &mut markers {
        if let Some((pixel, size, tint)) = marker_nodes.remove(&marker.key) {
            node.left = Val::Px(pixel.x - size * 0.5);
            node.top = Val::Px(pixel.y - size * 0.5);
            node.width = Val::Px(size);
            node.height = Val::Px(size);
            color.0 = tint;
        } else {
            commands.entity(entity).despawn();
        }
    }
    for (key, (pixel, size, color)) in marker_nodes {
        commands.spawn((
            BodyMarker { key },
            Node {
                position_type: PositionType::Absolute,
                left: Val::Px(pixel.x - size * 0.5),
                top: Val::Px(pixel.y - size * 0.5),
                width: Val::Px(size),
                height: Val::Px(size),
                border_radius: BorderRadius::MAX,
                ..default()
            },
            BackgroundColor(color),
        ));
    }
    let orbit_visibility = if core.focused_object().is_some() {
        crate::orbit_lines::distance_fade(camera_transform.translation().length())
    } else {
        1.
    };
    for (id, label, points) in core.annotations() {
        let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
            continue;
        };
        if let Some(points) = points.filter(|_| orbit_visibility > 0.) {
            let style = core.trajectory_style(id);
            let origin = if let Some(origin) = style.and_then(|s| s.origin_id.as_deref()) {
                let Ok(parent) = core.object_state_at(origin, core.clock().epoch()) else {
                    continue;
                };
                parent.position_km
            } else {
                [0.; 3]
            };
            let current = std::array::from_fn(|i| state.position_km[i] - origin[i]);
            let color = style
                .and_then(|s| s.color_rgba)
                .unwrap_or([0.35, 0.55, 0.7, 1.]);
            crate::orbit_lines::visit_segments(
                points,
                core.trajectory_epochs(id),
                core.clock().epoch(),
                current,
                |a, b| {
                    let a = to_display(std::array::from_fn(|i| a[i] + origin[i]));
                    let b = to_display(std::array::from_fn(|i| b[i] + origin[i]));
                    if a.is_finite() && b.is_finite() {
                        let selected = core.focused_object() == Some(id);
                        gizmos.line(
                            a,
                            b,
                            Color::srgba(
                                color[0],
                                color[1],
                                color[2],
                                orbit_visibility
                                    * color[3]
                                    * if selected {
                                        0.65
                                    } else if core.focused_object().is_some() {
                                        0.3
                                    } else {
                                        0.6
                                    },
                            ),
                        );
                    }
                },
            );
        }
        if let Some(text) = label.filter(|text| !text.is_empty()) {
            let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
                continue;
            };
            let position = to_display(state.position_km);
            if let Ok(pixel) = camera.world_to_viewport(camera_transform, position) {
                if pixel.x < 0. || pixel.y < 0. || pixel.x > viewport.x || pixel.y > viewport.y {
                    fades.remove(id);
                    continue;
                }
                let local_system = !*near_focus
                    || focus_range.is_none_or(|range| {
                        scientific_camera.distance(DVec3::from_array(state.position_km))
                            < range * 100.
                    });
                let blocked = crate::label_visibility::occluded(
                    scientific_camera,
                    DVec3::from_array(state.position_km),
                    &spheres,
                    id,
                );
                let allowed = local_system && !blocked;
                let coverage = (state.radius_km
                    / scientific_camera
                        .distance(DVec3::from_array(state.position_km))
                        .max(state.radius_km)) as f32;
                let alpha = fades.entry(id.to_owned()).or_default().update(
                    coverage,
                    allowed,
                    core.focused_object() == Some(id) && !solar_overview,
                    time.delta_secs(),
                );
                if !blocked && alpha > 0.02 {
                    opacity.insert(id.to_owned(), alpha);
                    desired_labels.push((id.to_owned(), text.to_owned(), pixel));
                }
            } else {
                fades.remove(id);
            }
        }
    }
    let priority = core.focused_object().or_else(|| {
        core.object_ids().find(|id| {
            core.visual_assignment(id).is_some_and(|v| {
                matches!(
                    v.spec,
                    VisualSpec::Sphere {
                        emissive_rgba: Some(_),
                        ..
                    }
                )
            })
        })
    });
    let desired_labels =
        crate::screen_layout::place_labels_measured(desired_labels, viewport, priority, &measured);
    for (id, text, anchor) in &desired_labels {
        if opacity.get(id).copied().unwrap_or(0.) < 0.5 {
            continue;
        }
        if let Some(&depth) = depths.get(id) {
            pick_frame.targets.push(PickTarget {
                id: id.clone(),
                depth,
                shape: PickShape::Label {
                    min: (*anchor + Vec2::new(8., -8.)).to_array(),
                    size: measured
                        .get(id)
                        .copied()
                        .unwrap_or_else(|| crate::screen_layout::label_size(text))
                        .to_array(),
                },
            });
        }
    }
    if let Ok(mut frame) = picks.0.lock() {
        *frame = pick_frame;
    }
    let font = if desired_labels.is_empty() {
        label_font.clone().unwrap_or_default()
    } else {
        label_font
            .get_or_insert_with(|| assets.load("fonts/FiraMono-subset.ttf"))
            .clone()
    };
    maintain_labels(&mut commands, &mut labels, desired_labels, font, &opacity);
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
            &std::collections::HashMap::from([("earth".to_owned(), 0.2)]),
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
        // Existing labels must update opacity; only surviving entities may receive commands.
        app.world_mut()
            .entity_mut(entity)
            .insert(TextColor(Color::WHITE));
        app.world_mut().resource_mut::<DesiredLabels>().0 =
            vec![("earth".into(), "EARTH updated".into(), Vec2::splat(10.))];
        app.update();
        assert!(app.world().get::<AnnotationLabel>(entity).is_some());
        assert!((app.world().get::<TextColor>(entity).unwrap().0.alpha() - 0.2).abs() < 1e-5);
        assert_eq!(app.world().get::<Text>(entity).unwrap().0, "EARTH updated");
        assert_eq!(app.world().get::<Node>(entity).unwrap().left, Val::Px(18.));
        app.world_mut().resource_mut::<DesiredLabels>().0.clear();
        app.update();
        assert!(app.world().get::<AnnotationLabel>(entity).is_none());
        // Removal must not leave a later TextColor insertion targeting the dead entity.
        app.update();
        assert_eq!(
            app.world_mut()
                .query_filtered::<Entity, With<AnnotationLabel>>()
                .iter(app.world())
                .count(),
            0
        );
    }
}

#[cfg(test)]
mod repeated_focus_tests {
    use super::*;
    use crate::{Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn overview_distance_is_not_reinterpreted_before_new_focus_is_framed() {
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
            c.register_object("s", "sun").unwrap();
            c.set_object_state(
                "s",
                "sun",
                ObjectState {
                    orientation_wxyz: None,
                    position_km: [0.; 3],
                    radius_km: 695500.,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    frame: "ICRF".into(),
                    source: "test".into(),
                },
            )
            .unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        app.world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()));
        app.update();
        app.world_mut().resource_mut::<OrbitView>().distance = 1e12;
        shared.lock().unwrap().focus("s", "p", "sun").unwrap();
        app.update();
        assert_eq!(shared.lock().unwrap().focused_object(), Some("sun"));
        let view = app.world().resource::<OrbitView>();
        assert_eq!(view.target.as_deref(), Some("sun"));
        assert!(
            view.distance < 100.,
            "old overview distance leaked into focused radius units"
        );
        app.update();
        assert_eq!(shared.lock().unwrap().focused_object(), Some("sun"));
    }
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

// Current host scene uses a central light at its ICRF origin. This does not
// grant plugins an environment-light API through emissive material settings.
fn update_illumination(
    settings: Res<DisplaySettings>,
    mut lights: Query<&mut Transform, With<DirectionalLight>>,
) {
    let toward = -settings.origin_km;
    if toward.length_squared() < 1e-12 {
        return;
    }
    let d = toward.normalize();
    let d = Vec3::new(d.x as f32, d.z as f32, -d.y as f32);
    for mut transform in &mut lights {
        *transform = Transform::from_translation(d * 10.).looking_at(Vec3::ZERO, Vec3::Y);
    }
}

#[cfg(test)]
mod camera_collision_system_tests {
    use super::*;
    use crate::Core;
    use std::sync::Mutex;
    #[test]
    fn a_noncentral_body_blocks_camera_after_floating_origin_changes() {
        let shared = Arc::new(Mutex::new(Core::default()));
        let center = DVec3::new(1e8, 0., 0.);
        {
            let mut core = shared.lock().unwrap();
            core.open_session_with_permissions("s", "p", crate::SessionPermissions::default())
                .unwrap();
            core.register_object("s", "planet").unwrap();
            core.set_object_state(
                "s",
                "planet",
                crate::ObjectState {
                    position_km: center.to_array(),
                    radius_km: 1000.,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    orientation_wxyz: None,
                    frame: "ICRF".into(),
                    source: "collision fixture".into(),
                },
            )
            .unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared))
            .insert_resource(DisplaySettings {
                origin_km: center,
                units_per_km: 0.001,
            })
            .add_systems(Update, enforce_camera_collision);
        let camera = app
            .world_mut()
            .spawn((
                DisplayCamera,
                Transform::from_xyz(0., 5., 0.),
                Projection::default(),
            ))
            .id();
        app.update();
        {
            let mut settings = app.world_mut().resource_mut::<DisplaySettings>();
            settings.origin_km = DVec3::ZERO;
            settings.units_per_km = AU_KM.recip();
        }
        app.world_mut()
            .get_mut::<Transform>(camera)
            .unwrap()
            .translation = Vec3::new((1e8 / AU_KM) as f32, (-5000. / AU_KM) as f32, 0.);
        app.update();
        let transform = app.world().get::<Transform>(camera).unwrap();
        let local = transform.translation.as_dvec3() * AU_KM;
        let result = DVec3::new(local.x, -local.z, local.y);
        assert!(result.z > 0., "camera crossed planet: {result}");
        assert!(result.distance(center) > 1000.);
    }
}
