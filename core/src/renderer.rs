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
    // SDK/UI intentions remain valid when focus moves from the canvas to controls.
    host_zoom: crate::camera_motion::Motion,
    input_active: bool,
    target: Option<String>,
    focus_revision: u64,
    framing_radius_km: f64,
    system_framing_km: Option<(f64, f32, f32)>,
    yaw: f32,
    pitch: f32,
    distance: f32,
}
impl Default for OrbitView {
    fn default() -> Self {
        Self {
            motion: crate::camera_motion::Motion::default(),
            host_zoom: crate::camera_motion::Motion::default(),
            input_active: false,
            target: None,
            focus_revision: 0,
            framing_radius_km: 0.,
            system_framing_km: None,
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
    if let Ok(mut state) = core.lock() {
        state.record_camera_render_status(None);
    }
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
    .register_asset_loader(crate::hdr_assets::SeHdrLoader)
    .init_resource::<crate::deep_lod::DeepSpaceLod>()
    .add_systems(
        PostUpdate,
        crate::deep_lod::update_lod
            .after(bevy::transform::TransformSystems::Propagate)
            .after(bevy::camera::CameraUpdateSystems),
    )
    .add_systems(
        Update,
        crate::deep_render::sync_environment.after(update_focus),
    )
    .add_systems(
        Update,
        crate::sky_render::sync_sky
            .after(sync_scene)
            .after(crate::deep_render::sync_environment),
    )
    .add_plugins(MaterialPlugin::<crate::trajectory_render::TrajectoryMaterial>::default())
    .init_resource::<crate::trajectory_render::TrajectoryBatch>()
    .add_systems(
        PostUpdate,
        crate::trajectory_render::upload.after(draw_annotations),
    )
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
    .init_resource::<crate::joint_render::JointRenderState>()
    .add_systems(
        PostUpdate,
        crate::joint_render::apply_model_joints
            .after(bevy::app::AnimationSystems)
            .before(bevy::transform::TransformSystems::Propagate),
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
    .add_systems(
        Update,
        update_camera_fill
            .after(enforce_camera_collision)
            .after(update_illumination),
    )
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
        SolarDirectionalLight,
        DirectionalLight {
            illuminance: 10_000.0,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::from_xyz(4.0, 4.0, 8.0).looking_at(Vec3::ZERO, Vec3::Y),
    ));
    commands.spawn((
        CameraFillLight,
        PointLight {
            intensity: 0.,
            shadow_maps_enabled: false,
            ..default()
        },
        Transform::default(),
    ));
}

#[derive(Component)]
struct SolarDirectionalLight;
#[derive(Component)]
struct CameraFillLight;
type CameraFillLights<'w, 's> = Query<
    'w,
    's,
    (&'static mut Transform, &'static mut PointLight),
    (With<CameraFillLight>, Without<DisplayCamera>),
>;
fn update_camera_fill(
    store: Res<CoreStore>,
    camera: Query<&Transform, (With<DisplayCamera>, Without<CameraFillLight>)>,
    mut lights: CameraFillLights,
) {
    let Ok(core) = store.0.lock() else { return };
    let Some(camera) = camera.iter().next() else {
        return;
    };
    let illuminance = match core.camera_lighting() {
        "shadow" => 1500.,
        "flood" => 10000.,
        _ => 0.,
    };
    // WebGL2 Bevy supports one directional light: reserve it for the Sun.
    // This is a camera-attached display aid, not another astronomical source.
    // I = E*r², luminous flux = 4*pi*I. Use current display units so floating
    // origin / planet-radius scaling does not change the requested center lux.
    let distance = camera.translation.length();
    let distance = if distance.is_finite() && distance > 0. {
        distance.clamp(1e-8, 1e8)
    } else {
        1.
    };
    for (mut transform, mut light) in &mut lights {
        *transform = *camera;
        light.intensity = illuminance * distance * distance * (2. * std::f32::consts::TAU);
        light.range = distance * 64.;
    }
}

#[derive(Default)]
struct CollisionHistory {
    safe_km: Option<DVec3>,
    origin_km: DVec3,
    focus: Option<String>,
}

#[derive(Default)]
struct CameraBlend {
    key: Option<String>,
    start_km: DVec3,
    start_rotation: Quat,
    anchor_origin_km: DVec3,
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
            self.anchor_origin_km = new.origin_km;
            self.elapsed = if was_initialized && delta.is_some() {
                0.0
            } else {
                0.35
            };
        }
        if !changed {
            self.start_km += new.origin_km - self.anchor_origin_km;
            self.anchor_origin_km = new.origin_km;
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
    for (_, mut projection) in camera.iter_mut() {
        if let Projection::Perspective(p) = &mut *projection {
            // NASA CameraComponent defines FOV on the longer viewport axis.
            // Bevy PerspectiveProjection stores vertical FOV.
            let long_fov = core.camera_fov_degrees().to_radians();
            let aspect = if p.aspect_ratio.is_finite() {
                p.aspect_ratio.max(1.)
            } else {
                1.
            };
            p.fov = 2. * ((long_fov * 0.5).tan() / aspect).atan();
        }
    }
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
        orbit.host_zoom.clear();
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
        orbit.framing_radius_km = radius;
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
        apply_controlled_input(&mut core, &mut orbit, delta.unwrap_or(1. / 60.));
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
    let focused_id = core.focused_object().map(str::to_owned);
    let Some(id) = focused_id.as_deref() else {
        return;
    };
    let Ok(state) = core.object_state_at(id, core.clock().epoch()).cloned() else {
        return;
    };
    let distance_km = orbit.distance as f64
        * if orbit.target.as_deref() == Some(id) && orbit.framing_radius_km > 0. {
            orbit.framing_radius_km
        } else {
            state.radius_km
        };
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
    apply_controlled_input(&mut core, &mut orbit, delta.unwrap_or(1. / 60.));
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
    if let Some(assignment) = core.visual_assignment(id)
        && let VisualSpec::Model {
            framing_radius_km: Some(hint),
            ..
        } = assignment.spec
    {
        let hinted = (hint * settings.units_per_km) as f32;
        if hinted.is_finite() && hinted > 0. {
            radius = hinted.max(1e-7);
        }
    }
    if let Some(observation) = core.camera_observation()
        && observation.mode == "system"
    {
        let aspect = camera
            .iter_mut()
            .find_map(|(_, p)| match &*p {
                Projection::Perspective(p) => Some(p.aspect_ratio),
                _ => None,
            })
            .unwrap_or(1.);
        let resized = orbit
            .system_framing_km
            .is_some_and(|(_, old, _)| (old - aspect).abs() > 0.001);
        if view_changed || resized || orbit.system_framing_km.is_none() {
            use crate::camera_framing::{
                FramingBody, fit_distance, system_min_distance_km, visual_extent_km,
            };
            let mut bodies = vec![FramingBody {
                offset_km: center.as_dvec3() / settings.units_per_km,
                radius_km: radius as f64 / settings.units_per_km,
            }];
            for member in observation
                .members
                .iter()
                .filter(|member| member.as_str() != id)
            {
                if let Ok(state) = core.object_state_at(member, core.clock().epoch()) {
                    let offset = DVec3::from_array(state.position_km) - settings.origin_km;
                    bodies.push(FramingBody {
                        offset_km: DVec3::new(offset.x, offset.z, -offset.y),
                        radius_km: visual_extent_km(
                            state.radius_km,
                            core.visual_assignment(member).map(|v| &v.spec),
                        ),
                    });
                }
            }
            let (yaw, pitch) = match core.camera_view() {
                "top" => (0., -1.5),
                "front" => (0., 0.),
                "side" => (std::f64::consts::FRAC_PI_2, 0.),
                _ => (orbit.yaw as f64, orbit.pitch as f64),
            };
            let rotation =
                bevy::math::DQuat::from_rotation_y(yaw) * bevy::math::DQuat::from_rotation_x(pitch);
            for (_, projection) in &mut camera {
                if let Projection::Perspective(p) = &*projection {
                    let vertical = p.fov as f64 * 0.5;
                    let horizontal = (vertical.tan() * p.aspect_ratio as f64).atan();
                    if let Some(fit) = fit_distance(&bodies, rotation, horizontal, vertical) {
                        let distance = (fit * 1.3).max(system_min_distance_km(id).unwrap_or(0.));
                        // Freeze the entry fit, as NASA's camera transition does;
                        // moving satellites must not continuously pump the zoom.
                        let factor = (1.3 / horizontal.min(vertical).sin()) as f32;
                        if resized
                            && !view_changed
                            && let Some((_, _, previous)) = orbit.system_framing_km
                        {
                            orbit.distance *= factor / previous;
                        }
                        orbit.system_framing_km =
                            Some((distance / factor as f64, p.aspect_ratio, factor));
                    }
                }
            }
        }
        if let Some((fit, _, _)) = orbit.system_framing_km {
            radius = (fit * settings.units_per_km) as f32;
        }
        center = Vec3::ZERO;
    } else {
        orbit.system_framing_km = None;
    }
    orbit.framing_radius_km = radius as f64 / settings.units_per_km;
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
                distance = if core
                    .camera_observation()
                    .is_some_and(|v| v.mode == "follow")
                {
                    distance.max(1.1 / half_fov.sin())
                } else {
                    1.3 / half_fov.sin()
                };
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
        let mut desired =
            Transform::from_translation(center + position).looking_at(center, Vec3::Y);
        if let Some(observation) = core.camera_observation()
            && observation.mode == "follow"
            && let Some(reference) = observation.follow_id.as_deref()
            && let Ok(reference) = core.object_state_at(reference, core.clock().epoch())
        {
            let direction = follow_display_direction(
                DVec3::from_array(reference.position_km) - settings.origin_km,
            );
            if direction.length_squared() > 0.5 {
                let side = direction.cross(Vec3::Y).try_normalize().unwrap_or(Vec3::X);
                let fov = core.camera_fov_degrees().to_radians();
                orbit.yaw = orbit.yaw.clamp(-0.45 * fov, 0.45 * fov);
                orbit.pitch = orbit.pitch.clamp(-0.4 * fov, 0.4 * fov);
                let horizontal_half_tan = match &*projection {
                    Projection::Perspective(p) => (p.fov * 0.5).tan() * p.aspect_ratio,
                    _ => (fov * 0.5).tan(),
                };
                let side_distance =
                    (distance * radius * horizontal_half_tan * 0.3).min(radius * 1.5);
                let offset = -direction * distance * radius + side * side_distance;
                desired = Transform::from_translation(offset).looking_to(
                    Quat::from_axis_angle(Vec3::Y, orbit.yaw)
                        * Quat::from_axis_angle(side, orbit.pitch)
                        * direction,
                    Vec3::Y,
                );
            }
        }
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
    orbit: Option<Res<OrbitView>>,
    mut cameras: Query<(&mut Transform, &mut Projection), With<DisplayCamera>>,
    mut previous: Local<CollisionHistory>,
) {
    let Ok(mut core) = store.0.lock() else {
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
    let focus = core.focused_object().map(str::to_owned);
    // Orbital time propagation is not a user camera segment through the parent.
    // Sweep local camera motion in the current target frame. A target switch
    // still sweeps the physical transition from the previous world position.
    let start = previous.safe_km.map_or(desired, |safe| {
        if focus.is_some() && focus == previous.focus {
            safe + settings.origin_km - previous.origin_km
        } else {
            safe
        }
    });
    let safe = crate::camera_collision::constrain(start, desired, &solids);
    previous.safe_km = Some(safe);
    previous.origin_km = settings.origin_km;
    previous.focus = focus;
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
    let desired_inside = core
        .object_ids()
        .filter_map(|id| {
            core.object_state_at(id, core.clock().epoch())
                .ok()
                .filter(|body| {
                    desired.distance(DVec3::from_array(body.position_km)) < body.radius_km
                })
                .map(|_| id.to_owned())
        })
        .collect();
    let status = crate::CameraRenderStatus {
        focused_id: core.focused_object().map(str::to_owned),
        position_km: safe.to_array(),
        desired_km: desired.to_array(),
        framing_radius_km: orbit.as_ref().map_or(0., |v| v.framing_radius_km),
        collision_adjusted: safe.distance_squared(desired) > 1e-18,
        desired_inside,
    };
    core.record_camera_render_status(Some(status));
    if let Projection::Perspective(p) = &mut *projection {
        let gap = solids
            .iter()
            .map(|body| (safe.distance(body.center) - body.radius).max(0.))
            .fold(f64::INFINITY, f64::min);
        if gap.is_finite() {
            p.near = p.near.min((gap * scale * 0.25).max(1e-12) as f32);
        }
        // Metre-scale model framing must not cull a kilometre-scale host body.
        // Bevy uses reverse infinite projection; far also bounds visibility.
        let extent = solids
            .iter()
            .map(|body| safe.distance(body.center) + body.radius)
            .fold(0., f64::max);
        let far = (extent * scale * 1.01).min(f32::MAX as f64 / 4.) as f32;
        if far.is_finite() {
            p.far = p.far.max(far);
        }
    }
}

fn follow_display_direction(relative: DVec3) -> Vec3 {
    let v = relative.normalize_or_zero();
    Vec3::new(v.x as f32, v.z as f32, -v.y as f32)
}
#[cfg(test)]
mod camera_intent_render_tests {
    use super::*;
    #[test]
    fn follow_keeps_craft_inside_nasa_field_of_view() {
        let mut core = crate::Core::default();
        core.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                camera_control: true,
                ..default()
            },
        )
        .unwrap();
        for (id, position, radius) in [
            ("mars", [0., 0., 0.], 3390.),
            ("craft", [4000., 0., 0.], 0.007),
        ] {
            core.register_object("s", id).unwrap();
            core.set_object_state(
                "s",
                id,
                crate::ObjectState {
                    position_km: position,
                    radius_km: radius,
                    epoch_tdb_seconds: 0.,
                    coverage_tdb_seconds: [0., 1.],
                    orientation_wxyz: None,
                    frame: "ICRF".into(),
                    source: "test".into(),
                },
            )
            .unwrap();
        }
        core.set_camera_observation("s", "p", "craft", "follow", vec![], Some("mars".into()))
            .unwrap();
        let shared = Arc::new(std::sync::Mutex::new(core));
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        for aspect in [2_f32, 0.5] {
            for fov in [10_f32, 45., 100.] {
                shared
                    .lock()
                    .unwrap()
                    .set_camera_fov("s", "p", fov)
                    .unwrap();
                let Projection::Perspective(p) =
                    &mut *app.world_mut().get_mut::<Projection>(camera).unwrap()
                else {
                    panic!()
                };
                p.aspect_ratio = aspect;
                app.update();
                let pose = app.world().get::<Transform>(camera).unwrap();
                let target = pose.rotation.inverse() * (-pose.translation);
                let Projection::Perspective(p) = app.world().get::<Projection>(camera).unwrap()
                else {
                    panic!()
                };
                let ndc_x = (target.x / -target.z) / ((p.fov / 2.).tan() * aspect);
                assert!(
                    ndc_x.abs() < 0.7,
                    "follow craft must stay safely in frame, fov={fov}, aspect={aspect}, x={ndc_x}"
                );
            }
        }
    }
    #[test]
    fn field_of_view_matches_eyes_long_viewport_axis() {
        let mut core = crate::Core::default();
        core.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                camera_control: true,
                ..default()
            },
        )
        .unwrap();
        core.set_camera_fov("s", "p", 100.).unwrap();
        let mut app = App::new();
        app.insert_resource(CoreStore(Arc::new(std::sync::Mutex::new(core))))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((
                DisplayCamera,
                Transform::default(),
                Projection::Perspective(PerspectiveProjection::default()),
            ))
            .id();
        for aspect in [2_f32, 0.5, 1., 16. / 9.] {
            let Projection::Perspective(p) =
                &mut *app.world_mut().get_mut::<Projection>(camera).unwrap()
            else {
                panic!()
            };
            p.aspect_ratio = aspect;
            app.update();
            let Projection::Perspective(p) = app.world().get::<Projection>(camera).unwrap() else {
                panic!()
            };
            let horizontal = 2. * ((p.fov / 2.).tan() * aspect).atan();
            assert!(
                (p.fov.max(horizontal).to_degrees() - 100.).abs() < 0.001,
                "same NASA FOV must not turn into a 134-degree wide view"
            );
            let half = (100_f32.to_radians() / 2.).tan();
            let horizontal_scale = 1. / ((p.fov / 2.).tan() * aspect);
            let expected = if aspect >= 1. {
                1. / half
            } else {
                1. / (half * aspect)
            };
            assert!((horizontal_scale - expected).abs() < 1e-5);
        }
    }

    #[test]
    fn startup_reserves_webgl_directional_budget_for_sun() {
        let mut app = App::new();
        app.init_resource::<Assets<Mesh>>()
            .add_systems(Startup, setup);
        app.update();
        let world = app.world_mut();
        assert_eq!(world.query::<&DirectionalLight>().iter(world).count(), 1);
        assert_eq!(
            world
                .query_filtered::<&DirectionalLight, With<SolarDirectionalLight>>()
                .iter(world)
                .count(),
            1
        );
        assert_eq!(
            world
                .query_filtered::<&PointLight, With<CameraFillLight>>()
                .iter(world)
                .count(),
            1
        );
    }
    #[test]
    fn camera_fill_tracks_final_camera_without_rotating_solar_light() {
        let mut c = crate::Core::default();
        c.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                camera_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        let shared = Arc::new(std::sync::Mutex::new(c));
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .insert_resource(DisplaySettings {
                origin_km: DVec3::new(1e12, 0., 0.),
                ..default()
            })
            .add_systems(Update, (update_illumination, update_camera_fill).chain());
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default()))
            .id();
        let sun = app
            .world_mut()
            .spawn((
                SolarDirectionalLight,
                DirectionalLight {
                    illuminance: 10000.,
                    ..default()
                },
                Transform::default(),
            ))
            .id();
        let fill = app
            .world_mut()
            .spawn((CameraFillLight, PointLight::default(), Transform::default()))
            .id();
        for (mode, power) in [("natural", 0.), ("shadow", 1500.), ("flood", 10000.)] {
            shared
                .lock()
                .unwrap()
                .set_camera_lighting("s", "p", mode)
                .unwrap();
            let rotation = Quat::from_rotation_y(power / 10000.);
            app.world_mut()
                .get_mut::<Transform>(camera)
                .unwrap()
                .rotation = rotation;
            app.world_mut()
                .get_mut::<Transform>(camera)
                .unwrap()
                .translation = Vec3::Z;
            app.update();
            assert_eq!(
                app.world_mut()
                    .query::<&DirectionalLight>()
                    .iter(app.world())
                    .count(),
                1
            );
            assert_eq!(
                app.world().get::<Transform>(fill).unwrap().translation,
                Vec3::Z
            );
            assert_eq!(
                app.world().get::<PointLight>(fill).unwrap().intensity,
                power * std::f32::consts::TAU * 2.
            );
            assert_eq!(
                app.world().get::<Transform>(fill).unwrap().rotation,
                rotation
            );
            assert_eq!(
                app.world()
                    .get::<DirectionalLight>(sun)
                    .unwrap()
                    .illuminance,
                10000.
            );
            assert!(
                app.world()
                    .get::<Transform>(sun)
                    .unwrap()
                    .forward()
                    .dot(Vec3::X)
                    > 0.999
            );
        }
        shared
            .lock()
            .unwrap()
            .set_camera_lighting("s", "p", "shadow")
            .unwrap();
        for distance in [1e-5_f32, 0.25, 4., 1000.] {
            app.world_mut()
                .get_mut::<Transform>(camera)
                .unwrap()
                .translation = Vec3::Z * distance;
            app.update();
            let fill_light = app.world().get::<PointLight>(fill).unwrap();
            let center_lux =
                fill_light.intensity / (2. * std::f32::consts::TAU * distance * distance);
            assert!((center_lux - 1500.).abs() < 0.001);
            assert!(fill_light.range >= distance * 32.);
            assert!(!fill_light.shadow_maps_enabled);
        }
        app.world_mut().resource_mut::<DisplaySettings>().origin_km = DVec3::new(0., 1e12, 0.);
        app.update();
        assert!(
            app.world()
                .get::<Transform>(sun)
                .unwrap()
                .forward()
                .dot(-Vec3::Z)
                > 0.999
        );
        assert_eq!(
            app.world().get::<Transform>(fill).unwrap().rotation,
            app.world().get::<Transform>(camera).unwrap().rotation
        );
    }
    #[test]
    fn observation_modes_frame_large_origin_and_follow_moving_reference() {
        let mut core = crate::Core::default();
        core.open_session_with_permissions(
            "s",
            "p",
            crate::SessionPermissions {
                camera_control: true,
                ..Default::default()
            },
        )
        .unwrap();
        let state = |position| crate::ObjectState {
            position_km: position,
            radius_km: 1.,
            epoch_tdb_seconds: 0.,
            coverage_tdb_seconds: [0., 1.],
            frame: "ICRF".into(),
            source: "test".into(),
            orientation_wxyz: None,
        };
        let origin = [1e12, 1e12, 1e12];
        for (id, position) in [("target", origin), ("reference", [1e12 + 50., 1e12, 1e12])] {
            core.register_object("s", id).unwrap();
            core.set_object_state("s", id, state(position)).unwrap();
        }
        let shared = Arc::new(std::sync::Mutex::new(core));
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, (update_focus, enforce_camera_collision).chain());
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        shared
            .lock()
            .unwrap()
            .set_camera_observation("s", "p", "target", "nearby", vec![], None)
            .unwrap();
        app.update();
        assert!(
            app.world()
                .get::<Transform>(camera)
                .unwrap()
                .translation
                .length()
                < 10.
        );
        shared
            .lock()
            .unwrap()
            .set_camera_observation(
                "s",
                "p",
                "target",
                "system",
                vec!["target".into(), "reference".into()],
                None,
            )
            .unwrap();
        app.update();
        let t = app.world().get::<Transform>(camera).unwrap();
        assert!(t.translation.length() > 50.);
        assert!(t.forward().dot((-t.translation).normalize()) > 0.9999);
        shared
            .lock()
            .unwrap()
            .set_camera_observation(
                "s",
                "p",
                "target",
                "follow",
                vec![],
                Some("reference".into()),
            )
            .unwrap();
        app.update();
        let t = app.world().get::<Transform>(camera).unwrap();
        assert!(t.forward().dot(Vec3::X) > 0.99);
        assert!(t.translation.is_finite() && t.translation.length() > 1.);
        shared
            .lock()
            .unwrap()
            .set_object_state("s", "reference", state([1e12, 1e12 + 50., 1e12]))
            .unwrap();
        app.update();
        let t = app.world().get::<Transform>(camera).unwrap();
        assert!(t.forward().dot(-Vec3::Z) > 0.99);
        assert!(t.translation.is_finite() && t.translation.length() > 1.);
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .object_state_at("target", 0.)
                .unwrap()
                .position_km,
            origin
        );
        shared
            .lock()
            .unwrap()
            .set_object_state("s", "reference", state(origin))
            .unwrap();
        assert!(
            shared
                .lock()
                .unwrap()
                .set_camera_observation(
                    "s",
                    "p",
                    "target",
                    "follow",
                    vec![],
                    Some("reference".into())
                )
                .is_err()
        );
    }
    #[test]
    fn follow_uses_display_basis_and_changes_with_reference() {
        assert_eq!(follow_display_direction(DVec3::X), Vec3::X);
        assert_eq!(follow_display_direction(DVec3::Y), -Vec3::Z);
        assert_eq!(follow_display_direction(DVec3::Z), Vec3::Y);
        assert_eq!(follow_display_direction(DVec3::ZERO), Vec3::ZERO);
    }
    #[test]
    fn host_zoom_survives_canvas_blur_without_replaying_native_motion() {
        for focused in [false, true] {
            for hz in [30, 60, 120] {
                let mut core = crate::Core::default();
                core.open_session_with_permissions(
                    "s",
                    "p",
                    crate::SessionPermissions {
                        camera_control: true,
                        ..default()
                    },
                )
                .unwrap();
                core.register_object("s", "earth").unwrap();
                core.set_object_state(
                    "s",
                    "earth",
                    crate::ObjectState {
                        position_km: [0.; 3],
                        radius_km: 6378.1,
                        epoch_tdb_seconds: 0.,
                        coverage_tdb_seconds: [0., 10.],
                        frame: "ICRF".into(),
                        source: "test".into(),
                        orientation_wxyz: None,
                    },
                )
                .unwrap();
                core.focus("s", "p", "earth").unwrap();
                let shared = Arc::new(std::sync::Mutex::new(core));
                let mut app = App::new();
                app.insert_resource(CoreStore(shared.clone()))
                    .init_resource::<OrbitView>()
                    .init_resource::<DisplaySettings>()
                    .init_resource::<crate::face_texture::FaceCache>()
                    .init_resource::<ButtonInput<MouseButton>>()
                    .init_resource::<AccumulatedMouseMotion>()
                    .insert_resource(Time::<()>::default())
                    .add_message::<MouseWheel>()
                    .add_systems(Update, (orbit_input, update_focus).chain());
                let window = app
                    .world_mut()
                    .spawn(Window {
                        focused,
                        ..default()
                    })
                    .id();
                app.world_mut()
                    .spawn((DisplayCamera, Transform::default(), Projection::default()));
                let dt = std::time::Duration::from_secs_f64(1. / hz as f64);
                app.world_mut().resource_mut::<Time>().advance_by(dt);
                app.update();
                let before = app.world().resource::<OrbitView>().distance;
                if !focused {
                    let mut orbit = app.world_mut().resource_mut::<OrbitView>();
                    orbit.motion.drag([0.08, 0.04], dt.as_secs_f32());
                    orbit.motion.zoom(0.8);
                }
                shared.lock().unwrap().camera_zoom("s", "p", 0.3).unwrap();
                for _ in 0..hz {
                    app.world_mut().resource_mut::<Time>().advance_by(dt);
                    app.update();
                }
                let orbit = app.world().resource::<OrbitView>();
                assert!(
                    (orbit.distance / before - 0.3_f32.exp()).abs() < 0.0001,
                    "host intent must survive blur and apply once: focused={focused}, hz={hz}"
                );
                assert_eq!(orbit.yaw, 0.);
                assert_eq!(orbit.pitch, 0.);
                if !focused {
                    app.world_mut().get_mut::<Window>(window).unwrap().focused = true;
                    for _ in 0..3 {
                        app.world_mut().resource_mut::<Time>().advance_by(dt);
                        app.update();
                    }
                    let orbit = app.world().resource::<OrbitView>();
                    assert_eq!(orbit.yaw, 0.);
                    assert_eq!(orbit.pitch, 0.);
                    assert!((orbit.distance / before - 0.3_f32.exp()).abs() < 0.0001);
                }
                let mut core = shared.lock().unwrap();
                assert_eq!(core.take_camera_input(), [0.; 3]);
                assert_eq!(core.focused_object(), Some("earth"));
                assert_eq!(core.clock().epoch(), 0.);
                assert_eq!(core.object_state_at("earth", 0.).unwrap().radius_km, 6378.1);
            }
        }
    }
    #[test]
    fn controlled_zoom_is_consumed_once_independent_of_frame_duration() {
        for dt in [1. / 30., 1. / 60., 1. / 120.] {
            let mut c = crate::Core::default();
            c.open_session_with_permissions(
                "s",
                "p",
                crate::SessionPermissions {
                    camera_control: true,
                    ..Default::default()
                },
            )
            .unwrap();
            c.camera_zoom("s", "p", 0.3).unwrap();
            let mut orbit = OrbitView::default();
            let before = orbit.distance;
            apply_controlled_input(&mut c, &mut orbit, dt);
            assert!(orbit.distance > before);
            for _ in 1..(1. / dt).round() as u32 {
                apply_controlled_input(&mut c, &mut orbit, dt);
            }
            assert_eq!(c.take_camera_input(), [0.; 3]);
            assert!((orbit.distance / before - 0.3_f32.exp()).abs() < 0.0001);
            assert_eq!(orbit.motion.zoom_step(dt), 0.);
        }
    }
}

fn apply_controlled_input(core: &mut crate::Core, orbit: &mut OrbitView, dt: f32) {
    let input = core.take_camera_input();
    orbit.input_active |= input != [0.; 3];
    orbit.yaw += input[0];
    orbit.pitch = (orbit.pitch + input[1]).clamp(-1.5, 1.5);
    if input[0] != 0. || input[1] != 0. {
        orbit.motion.drag([input[0], input[1]], dt);
    }
    orbit.host_zoom.zoom(input[2]);
    let zoom = orbit.host_zoom.zoom_step(dt);
    orbit.input_active |= zoom.abs() > f32::EPSILON;
    orbit.distance = (orbit.distance * zoom.exp()).clamp(1e-8, 1e12);
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
    let focused = windows.iter().all(|w| w.focused);
    let available = !windows
        .iter()
        .any(|w| !w.focused || w.cursor_position().is_none());
    let dragging = drag_gate.accept(
        available,
        buttons.pressed(MouseButton::Left),
        buttons.just_pressed(MouseButton::Left),
    );
    orbit.input_active = dragging;
    if !focused {
        orbit.motion.clear();
        wheel.clear();
        return;
    }
    if available && buttons.just_pressed(MouseButton::Left) {
        orbit.motion.clear();
        orbit.host_zoom.clear();
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
    for event in wheel.read().filter(|_| available) {
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
fn stop_renderer(store: Res<CoreStore>, stop: Res<RendererStop>, mut exit: MessageWriter<AppExit>) {
    if stop.0.load(Ordering::Acquire) {
        if let Ok(mut core) = store.0.lock() {
            core.record_camera_render_status(None);
        }
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
                    framing_radius_km: None,
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
                    framing_radius_km: None,
                }),
            )
            .unwrap();
        }
        app.update();
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            Vec3::new(0.0, 0.0, 1.3 / (45.0_f32.to_radians() * 0.5).sin())
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
            Vec3::new(0.0, 0.0, 1.3 / (45.0_f32.to_radians() * 0.5).sin())
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
    alive: Option<&std::collections::HashSet<String>>,
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
            commands.entity(entity).insert(Visibility::Inherited);
            commands.entity(entity).insert(TextColor(Color::srgba(
                1.,
                1.,
                1.,
                opacity.get(&label.object).copied().unwrap_or(1.),
            )));
        } else if alive.is_some_and(|ids| ids.contains(&label.object)) {
            // Preserve glyph metrics and the entity through temporary collision,
            // occlusion or distance hiding, like NASA's persistent label divs.
            commands.entity(entity).insert(Visibility::Hidden);
        } else {
            commands.entity(entity).despawn();
        }
    }
    for (object, (text, pixel)) in desired {
        let alpha = opacity.get(&object).copied().unwrap_or(1.);
        commands.spawn((
            AnnotationLabel { object },
            Text::new(text),
            TextLayout::no_wrap(),
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
    mut lines: ResMut<crate::trajectory_render::TrajectoryBatch>,
    input: (Query<&Window>, Res<ButtonInput<MouseButton>>),
    mut labels: AnnotationLabels,
    assets: Res<AssetServer>,
    mut label_font: Local<Option<Handle<Font>>>,
    mut label_layout: Local<crate::screen_layout::LabelLayout>,
    mut fades: Local<std::collections::HashMap<String, crate::label_visibility::Fade>>,
    time: Res<Time>,
    mut near_focus: Local<bool>,
    mut markers: Query<
        (Entity, &BodyMarker, &mut Node, &mut BackgroundColor),
        Without<AnnotationLabel>,
    >,
    camera: Query<(&Camera, &GlobalTransform, &Projection), With<DisplayCamera>>,
) {
    lines.clear();
    let (windows, buttons) = input;
    let cursor = windows.iter().next().and_then(|window| {
        window
            .cursor_position()
            .map(|p| [p.x / window.width(), p.y / window.height()])
    });
    let dragging = buttons.pressed(MouseButton::Left)
        || buttons.pressed(MouseButton::Right)
        || buttons.pressed(MouseButton::Middle);
    let previous_hover = picks
        .0
        .lock()
        .ok()
        .and_then(|frame| frame.hover(cursor, dragging).map(str::to_owned));
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
            None,
        );
        return;
    };
    let Ok((camera, camera_transform, projection)) = camera.single() else {
        maintain_labels(
            &mut commands,
            &mut labels,
            Vec::new(),
            Handle::default(),
            &opacity,
            None,
        );
        return;
    };
    let to_display = |p: [f64; 3]| {
        let p = (DVec3::from_array(p) - settings.origin_km) * settings.units_per_km;
        Vec3::new(p.x as f32, p.z as f32, -p.y as f32)
    };
    let Some(observation) =
        crate::observation::ObservationProjection::from_camera(camera, projection)
    else {
        maintain_labels(
            &mut commands,
            &mut labels,
            Vec::new(),
            Handle::default(),
            &opacity,
            None,
        );
        return;
    };
    let viewport = observation.logical_size;
    let pick_ray = observation.pick_ray(camera_transform);
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
    label_layout.priorities.clear();
    let mut visible_objects = std::collections::HashSet::new();
    for id in core.object_ids() {
        let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
            continue;
        };
        if core
            .visual_status(id)
            .ok()
            .flatten()
            .is_some_and(|v| v.phase == VisualPhase::Ready)
            && let Some(ray) = pick_ray
            && let Some(assignment) = core.visual_assignment(id)
            && let VisualSpec::Sphere {
                ring_inner_radius_ratio: Some(inner),
                ring_outer_radius_ratio: Some(outer),
                ..
            } = assignment.spec
        {
            let center = to_display(state.position_km);
            let rotation = crate::runtime::display_rotation(state.orientation_wxyz);
            pick_frame.targets.push(PickTarget {
                id: id.to_owned(),
                depth: camera_transform.translation().distance(center),
                shape: PickShape::Ring {
                    ray,
                    center: center.as_dvec3().to_array(),
                    normal: (rotation * Vec3::Y).as_dvec3().to_array(),
                    inner_radius: state.radius_km * settings.units_per_km * inner,
                    outer_radius: state.radius_km * settings.units_per_km * outer,
                },
            });
        }
        if crate::label_visibility::occluded(
            scientific_camera,
            DVec3::from_array(state.position_km),
            &spheres,
            id,
        ) {
            continue;
        }
        let distance = scientific_camera.distance(DVec3::from_array(state.position_km));
        let weight = if id == "sun" {
            100
        } else if matches!(
            id,
            "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune"
        ) {
            50
        } else if id.starts_with("sc_") {
            30
        } else {
            25
        };
        label_layout
            .priorities
            .insert(id.to_owned(), (weight, distance));
        if !core
            .visual_status(id)
            .ok()
            .flatten()
            .is_some_and(|status| status.phase == VisualPhase::Ready)
        {
            continue;
        }
        let position = to_display(state.position_km);
        let Ok(pixel) = camera.world_to_viewport(camera_transform, position) else {
            continue;
        };
        let visual_radius = core
            .visual_assignment(id)
            .and_then(|v| match v.spec {
                VisualSpec::Model {
                    framing_radius_km, ..
                } => framing_radius_km,
                _ => None,
            })
            .unwrap_or(state.radius_km)
            .max(state.radius_km);
        let projected_radius = observation.radius_pixels(
            camera,
            camera_transform,
            position,
            (visual_radius * settings.units_per_km) as f32,
        );
        if pixel.x < 0. || pixel.y < 0. || pixel.x > viewport.x || pixel.y > viewport.y {
            continue;
        }
        if !crate::label_visibility::marker_projection_valid(projected_radius) {
            continue;
        }
        visible_objects.insert(id.to_owned());
        {
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
    let hovered = pick_frame
        .hover(cursor, dragging)
        .map(str::to_owned)
        .or_else(|| {
            previous_hover.filter(|id| pick_frame.targets.iter().any(|target| &target.id == id))
        });
    let orbit_visibility = if core.focused_object().is_some() {
        crate::orbit_lines::distance_fade(camera_transform.translation().length())
    } else {
        1.
    };
    for (id, label, points) in core.annotations() {
        let Ok(state) = core.object_state_at(id, core.clock().epoch()) else {
            continue;
        };
        let style = core.trajectory_style(id);
        let distance_visibility = crate::orbit_lines::parent_trail_visibility(
            orbit_visibility,
            style,
            core.focused_object(),
        );
        if let Some(points) = points.filter(|_| distance_visibility > 0.) {
            let path_visibility = crate::orbit_lines::path_scale_fade(
                points,
                focus_range,
                style.and_then(|s| s.kind.as_deref()),
            );
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
            crate::orbit_lines::visit_styled_segments(
                points,
                core.trajectory_epochs(id),
                core.clock().epoch(),
                current,
                style,
                |a, b, alpha_a, alpha_b| {
                    let a = to_display(std::array::from_fn(|i| a[i] + origin[i]));
                    let b = to_display(std::array::from_fn(|i| b[i] + origin[i]));
                    if a.is_finite() && b.is_finite() {
                        let opacity = distance_visibility
                            * path_visibility
                            * color[3]
                            * crate::trajectory_render::opacity(id, hovered.as_deref() == Some(id));
                        let ca = crate::trajectory_render::color(color, opacity * alpha_a);
                        let cb = crate::trajectory_render::color(color, opacity * alpha_b);
                        lines.line(
                            a,
                            b,
                            ca,
                            cb,
                            crate::trajectory_render::widths(
                                style.and_then(|s| s.kind.as_deref()) == Some("trail"),
                                hovered.as_deref() == Some(id),
                                [alpha_a, alpha_b],
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
                let visual_ready = core
                    .visual_status(id)
                    .ok()
                    .flatten()
                    .is_some_and(|status| status.phase == VisualPhase::Ready);
                let object_visible = visible_objects.contains(id);
                let allowed = local_system && !blocked && visual_ready && object_visible;
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
                if allowed && alpha > 0.02 {
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
    let alive_labels = core
        .annotations()
        .filter_map(|(id, label, _)| label.filter(|text| !text.is_empty()).map(|_| id.to_owned()))
        .collect();
    let desired_labels =
        label_layout.place(desired_labels, viewport, priority, &measured, &alive_labels);
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
    maintain_labels(
        &mut commands,
        &mut labels,
        desired_labels,
        font,
        &opacity,
        Some(&alive_labels),
    );
}

#[cfg(test)]
mod blend_tests {
    use super::*;
    #[test]
    fn moving_target_transition_stays_in_target_frame() {
        let old = DisplaySettings::new([1e12, 0., 0.], 1.).unwrap();
        let target = DisplaySettings::new([1e12 + 1000., 0., 0.], 2.).unwrap();
        let shifted = DisplaySettings::new([1e12 + 1e6 + 1000., -2e6, 3e6], 2.).unwrap();
        let previous = Transform::from_xyz(0., 0., 4.);
        let desired = Transform::from_xyz(0., 0., 4.);
        let mut a = CameraBlend::default();
        let mut b = CameraBlend::default();
        for blend in [&mut a, &mut b] {
            blend.apply("old", previous, previous, &old, &old, Some(0.));
            blend.apply("target", previous, desired, &old, &target, Some(0.));
        }
        let stationary = a.apply("target", previous, desired, &target, &target, Some(0.1));
        let moving = b.apply("target", previous, desired, &target, &shifted, Some(0.1));
        assert!(
            stationary.translation.distance(moving.translation) < 1e-4,
            "transition start must travel with the target, not lag millions of kilometres behind"
        );
    }

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
    #[derive(Resource, Default)]
    struct AliveLabels(Option<std::collections::HashSet<String>>);
    fn update_labels(
        mut commands: Commands,
        mut labels: AnnotationLabels,
        desired: Res<DesiredLabels>,
        alive: Res<AliveLabels>,
    ) {
        maintain_labels(
            &mut commands,
            &mut labels,
            desired.0.clone(),
            Handle::default(),
            &std::collections::HashMap::from([("earth".to_owned(), 0.2)]),
            alive.0.as_ref(),
        );
    }
    #[test]
    fn label_entities_survive_frames_and_are_removed_only_when_absent() {
        let mut app = App::new();
        app.init_resource::<DesiredLabels>()
            .init_resource::<AliveLabels>()
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
        app.world_mut().resource_mut::<AliveLabels>().0 =
            Some(["earth".to_owned()].into_iter().collect());
        app.world_mut().resource_mut::<DesiredLabels>().0.clear();
        app.update();
        assert_eq!(
            *app.world().get::<Visibility>(entity).unwrap(),
            Visibility::Hidden
        );
        app.world_mut().resource_mut::<DesiredLabels>().0 =
            vec![("earth".into(), "EARTH".into(), Vec2::ZERO)];
        app.update();
        assert_eq!(
            *app.world().get::<Visibility>(entity).unwrap(),
            Visibility::Inherited
        );
        app.world_mut().resource_mut::<AliveLabels>().0 = None;
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
    mut lights: Query<&mut Transform, (With<SolarDirectionalLight>, Without<CameraFillLight>)>,
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
    fn fast_orbit_rebases_sweep_and_keeps_parent_in_clip_range() {
        let shared = Arc::new(Mutex::new(Core::default()));
        {
            let mut c = shared.lock().unwrap();
            c.open_session_with_permissions(
                "s",
                "p",
                crate::SessionPermissions {
                    camera_control: true,
                    ..default()
                },
            )
            .unwrap();
            for (id, position, radius) in [
                ("mars", [0., 0., 0.], 3390.),
                ("craft", [4000., 0., 0.], 0.007),
            ] {
                c.register_object("s", id).unwrap();
                c.set_object_state(
                    "s",
                    id,
                    crate::ObjectState {
                        position_km: position,
                        radius_km: radius,
                        epoch_tdb_seconds: 0.,
                        coverage_tdb_seconds: [0., 1.],
                        orientation_wxyz: None,
                        frame: "ICRF".into(),
                        source: "test".into(),
                    },
                )
                .unwrap();
            }
            c.focus("s", "p", "craft").unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .insert_resource(DisplaySettings::new([4000., 0., 0.], 1. / 0.007).unwrap())
            .add_systems(Update, enforce_camera_collision);
        let camera = app
            .world_mut()
            .spawn((
                DisplayCamera,
                Transform::from_xyz(0., 0., 4.),
                Projection::default(),
            ))
            .id();
        for n in 0..12 {
            let angle = n as f64 * std::f64::consts::PI * 0.83;
            let origin = DVec3::new(4000. * angle.cos(), 4000. * angle.sin(), 0.);
            {
                let mut c = shared.lock().unwrap();
                let mut state = c.object_state_at("craft", 0.).unwrap().clone();
                state.position_km = origin.to_array();
                c.set_object_state("s", "craft", state).unwrap();
            }
            app.world_mut().resource_mut::<DisplaySettings>().origin_km = origin;
            *app.world_mut().get_mut::<Transform>(camera).unwrap() =
                Transform::from_xyz(0., 0., 4.);
            app.update();
            assert!(
                app.world()
                    .get::<Transform>(camera)
                    .unwrap()
                    .translation
                    .distance(Vec3::new(0., 0., 4.))
                    < 0.001,
                "time propagation must not become a camera chord through Mars at step {n}"
            );
            let Projection::Perspective(p) = app.world().get::<Projection>(camera).unwrap() else {
                panic!()
            };
            assert!(
                p.far as f64 * 0.007 >= 7390.,
                "parent sphere must fit far culling range when focused on a metre-scale craft"
            );
        }
        // A real user camera move through the craft still needs a sweep.
        *app.world_mut().get_mut::<Transform>(camera).unwrap() = Transform::from_xyz(0., 0., -4.);
        app.update();
        assert!(app.world().get::<Transform>(camera).unwrap().translation.z > 0.);
    }
    #[test]
    fn rumba_seek_then_focus_converges_with_solar_and_earth_collision() {
        use crate::{AssetDescriptor, AssetKind, ObjectState, SessionPermissions};
        let mut core = Core::default();
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
        let make = |position, radius| ObjectState {
            position_km: position,
            radius_km: radius,
            epoch_tdb_seconds: 0.,
            coverage_tdb_seconds: [0., 10.],
            orientation_wxyz: None,
            frame: "ICRF".into(),
            source: "test".into(),
        };
        for (id, position, radius) in [
            ("sun", [0., 0., 0.], 695700.),
            ("earth", [AU_KM, 0., 0.], 6371.),
        ] {
            core.register_object("s", id).unwrap();
            core.set_object_state("s", id, make(position, radius))
                .unwrap();
        }
        core.register_object("s", "rumba").unwrap();
        core.register_asset(
            "model",
            AssetDescriptor {
                kind: AssetKind::Model,
                path: "rumba.glb".into(),
            },
        )
        .unwrap();
        core.set_visual(
            "s",
            "p",
            "rumba",
            Some(VisualSpec::Model {
                asset_id: "model".into(),
                scene: 0,
                scale_km_per_unit: 1.,
                framing_radius_km: None,
            }),
        )
        .unwrap();
        let revision = core.visual_assignment("rumba").unwrap().revision;
        core.record_visual_status("rumba", revision, VisualPhase::Ready, None);
        let shared = Arc::new(Mutex::new(core));
        let mut app = App::new();
        let mut time = Time::<()>::default();
        time.advance_by(std::time::Duration::from_secs_f64(1. / 30.));
        app.insert_resource(time)
            .insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, (update_focus, enforce_camera_collision).chain());
        let camera = app
            .world_mut()
            .spawn((DisplayCamera, Transform::default(), Projection::default()))
            .id();
        let object = app
            .world_mut()
            .spawn((SceneObject { id: "rumba".into() }, Transform::default()))
            .id();
        let root = app
            .world_mut()
            .spawn((Transform::from_scale(Vec3::splat(0.001)), ChildOf(object)))
            .id();
        app.world_mut().spawn((
            Transform::default(),
            Aabb::from_min_max(Vec3::splat(-44.), Vec3::splat(44.)),
            ChildOf(root),
        ));
        for _ in 0..3 {
            shared
                .lock()
                .unwrap()
                .set_camera_view("s", "p", "overview")
                .unwrap();
            app.update();
            shared.lock().unwrap().focus("s", "p", "rumba").unwrap();
            app.update();
            shared
                .lock()
                .unwrap()
                .set_object_state(
                    "s",
                    "rumba",
                    make([AU_KM + 21991.95, -7928.51, 1772.93], 0.00435),
                )
                .unwrap();
            shared.lock().unwrap().focus("s", "p", "rumba").unwrap();
            for _ in 0..300 {
                app.update();
            }
            let settings = app.world().resource::<DisplaySettings>();
            let eye = app
                .world()
                .get::<Transform>(camera)
                .unwrap()
                .translation
                .as_dvec3()
                / settings.units_per_km;
            let eye = settings.origin_km + DVec3::new(eye.x, -eye.z, eye.y);
            let target = DVec3::new(AU_KM + 21991.95, -7928.51, 1772.93);
            assert!(
                eye.distance(target) < 1.,
                "camera distance {}",
                eye.distance(target)
            );
            assert_eq!(shared.lock().unwrap().focused_object(), Some("rumba"));
            assert!(eye.length() > 695700.);
            assert!(eye.distance(DVec3::new(AU_KM, 0., 0.)) > 6371.);
            let before = eye.distance(target);
            shared
                .lock()
                .unwrap()
                .set_visual(
                    "s",
                    "p",
                    "rumba",
                    Some(VisualSpec::Model {
                        asset_id: "model".into(),
                        scene: 0,
                        scale_km_per_unit: 1.,
                        framing_radius_km: Some(0.00435),
                    }),
                )
                .unwrap();
            for _ in 0..20 {
                app.update();
            }
            let camera_transform = app.world().get::<Transform>(camera).unwrap();
            let settings = app.world().resource::<DisplaySettings>();
            assert!(
                camera_transform.translation.length() as f64 / settings.units_per_km < before * 0.2
            );
            assert_eq!(
                shared
                    .lock()
                    .unwrap()
                    .object_state_at("rumba", 0.)
                    .unwrap()
                    .radius_km,
                0.00435
            );
            assert_eq!(
                app.world().get::<Transform>(root).unwrap().scale,
                Vec3::splat(0.001)
            );
            shared
                .lock()
                .unwrap()
                .set_visual(
                    "s",
                    "p",
                    "rumba",
                    Some(VisualSpec::Model {
                        asset_id: "model".into(),
                        scene: 0,
                        scale_km_per_unit: 1.,
                        framing_radius_km: Some(1e-300),
                    }),
                )
                .unwrap();
            for _ in 0..20 {
                app.update();
            }
            let transform = app.world().get::<Transform>(camera).unwrap();
            assert!(transform.translation.is_finite() && transform.rotation.is_finite());
            let Projection::Perspective(projection) =
                app.world().get::<Projection>(camera).unwrap()
            else {
                panic!("perspective")
            };
            assert!(
                projection.near.is_finite()
                    && projection.far.is_finite()
                    && projection.near > 0.
                    && projection.far > projection.near
            );
            let status = shared.lock().unwrap().camera_render_status().unwrap();
            let safe = DVec3::from_array(status.position_km);
            assert!(
                safe.distance(target) > 0.00435
                    && safe.length() > 695700.
                    && safe.distance(DVec3::new(AU_KM, 0., 0.)) > 6371.
            );
            // Restore full-bounds framing for the next repeated transition.
            shared
                .lock()
                .unwrap()
                .set_visual(
                    "s",
                    "p",
                    "rumba",
                    Some(VisualSpec::Model {
                        asset_id: "model".into(),
                        scene: 0,
                        scale_km_per_unit: 1.,
                        framing_radius_km: None,
                    }),
                )
                .unwrap();
            let revision = shared
                .lock()
                .unwrap()
                .visual_assignment("rumba")
                .unwrap()
                .revision;
            shared.lock().unwrap().record_visual_status(
                "rumba",
                revision,
                VisualPhase::Ready,
                None,
            );
        }
    }
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

#[cfg(test)]
mod nasa_framing_system_tests {
    use super::*;
    use crate::{Core, ObjectState, SessionPermissions};
    use std::sync::Mutex;
    #[test]
    fn system_fit_is_view_aware_stable_during_motion_and_refits_on_resize() {
        let shared = Arc::new(Mutex::new(Core::default()));
        let state = |position_km, radius_km| ObjectState {
            position_km,
            radius_km,
            orientation_wxyz: None,
            epoch_tdb_seconds: 0.,
            coverage_tdb_seconds: [0., 100.],
            frame: "ICRF".into(),
            source: "framing test".into(),
        };
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
            for (id, p, r) in [("host", [0.; 3], 100.), ("moon", [1000., 0., 0.], 10.)] {
                c.register_object("s", id).unwrap();
                c.set_object_state("s", id, state(p, r)).unwrap();
            }
            c.set_camera_observation(
                "s",
                "p",
                "host",
                "system",
                vec!["host".into(), "moon".into()],
                None,
            )
            .unwrap();
        }
        let mut app = App::new();
        app.insert_resource(CoreStore(shared.clone()))
            .init_resource::<DisplaySettings>()
            .init_resource::<OrbitView>()
            .add_systems(Update, update_focus);
        let camera = app
            .world_mut()
            .spawn((
                DisplayCamera,
                Transform::default(),
                Projection::Perspective(PerspectiveProjection {
                    aspect_ratio: 2.,
                    ..default()
                }),
            ))
            .id();
        app.update();
        let initial = app.world().resource::<OrbitView>().framing_radius_km;
        let position = app.world().get::<Transform>(camera).unwrap().translation;
        let Projection::Perspective(p) = app.world().get::<Projection>(camera).unwrap() else {
            panic!()
        };
        let v = p.fov as f64 * 0.5;
        let h = (v.tan() * p.aspect_ratio as f64).atan();
        let fit = crate::camera_framing::fit_distance(
            &[
                crate::camera_framing::FramingBody {
                    offset_km: DVec3::ZERO,
                    radius_km: 100.,
                },
                crate::camera_framing::FramingBody {
                    offset_km: DVec3::X * 1000.,
                    radius_km: 10.,
                },
            ],
            bevy::math::DQuat::IDENTITY,
            h,
            v,
        )
        .unwrap()
            * 1.3;
        assert!((position.length() as f64 * 100. - fit).abs() < 0.01);
        shared
            .lock()
            .unwrap()
            .set_object_state("s", "moon", state([2000., 0., 0.], 10.))
            .unwrap();
        app.update();
        assert_eq!(
            app.world().resource::<OrbitView>().framing_radius_km,
            initial,
            "moving satellites must not pump the camera zoom"
        );
        assert_eq!(
            app.world().get::<Transform>(camera).unwrap().translation,
            position
        );
        if let Some(mut projection) = app.world_mut().get_mut::<Projection>(camera)
            && let Projection::Perspective(p) = &mut *projection
        {
            p.aspect_ratio = 0.5;
        }
        app.update();
        assert!(
            app.world()
                .get::<Transform>(camera)
                .unwrap()
                .translation
                .length()
                > position.length()
        );
        let c = shared.lock().unwrap();
        assert_eq!(
            c.object_state_at("moon", 0.).unwrap().position_km,
            [2000., 0., 0.]
        );
        assert_eq!(c.object_state_at("moon", 0.).unwrap().radius_km, 10.);
    }
}
