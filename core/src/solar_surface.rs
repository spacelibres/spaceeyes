use bevy::{prelude::*, render::render_resource::AsBindGroup, shader::ShaderRef};
use std::collections::{HashMap, HashSet};
#[derive(Asset, AsBindGroup, TypePath, Debug, Clone)]
pub(crate) struct SolarSurfaceMaterial {
    #[uniform(0)]
    pub parameters: Vec4,
    #[uniform(1)]
    pub tuning: [Vec4; 19],
}
impl Material for SolarSurfaceMaterial {
    fn vertex_shader() -> ShaderRef {
        "shaders/solar-surface.wgsl".into()
    }
    fn fragment_shader() -> ShaderRef {
        "shaders/solar-surface.wgsl".into()
    }
    fn enable_prepass() -> bool {
        false
    }
    fn enable_shadows() -> bool {
        false
    }
}
#[derive(Resource, Default)]
pub(crate) struct SolarSurfaceLod {
    entries: HashMap<Entity, (Entity, Handle<SolarSurfaceMaterial>)>,
}
fn near(distance: f32, active: bool, enter: f32, exit: f32) -> bool {
    distance.is_finite() && distance >= 0. && distance < if active { exit } else { enter }
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_solar_surface(
    mut commands: Commands,
    roots: Query<(
        Entity,
        &GlobalTransform,
        &crate::stellar_render::StellarEmitter,
    )>,
    cameras: Query<&GlobalTransform, With<crate::renderer::DisplayCamera>>,
    shared: Res<crate::render_assets::SharedVisuals>,
    originals: Query<&MeshMaterial3d<StandardMaterial>>,
    mut standard: ResMut<Assets<StandardMaterial>>,
    mut materials: ResMut<Assets<SolarSurfaceMaterial>>,
    mut state: ResMut<SolarSurfaceLod>,
) {
    let camera = cameras.single().ok().map(GlobalTransform::translation);
    let mut keep = HashSet::new();
    for (root, transform, emitter) in &roots {
        let v = emitter.current_settings;
        let p = |i: usize| v[i / 4][i % 4];
        let radius = transform
            .to_scale_rotation_translation()
            .0
            .abs()
            .max_element();
        let distance = camera
            .filter(|_| radius.is_finite() && radius > 0.)
            .map_or(f32::INFINITY, |c| {
                c.distance(transform.translation()) / radius
            });
        let active = p(72) > 0.5
            && p(0) > 0.5
            && near(distance, state.entries.contains_key(&root), p(55), p(56));
        // Mask only the root's pixels: Visibility would also suppress its plasma children.
        if let Ok(handle) = originals.get(root)
            && let Some(mut m) = standard.get_mut(&handle.0)
        {
            m.alpha_mode = AlphaMode::Mask(0.5);
            m.base_color = m.base_color.with_alpha(if active { 0. } else { p(0) });
        }
        if !active {
            continue;
        }
        keep.insert(root);
        let parameters = Vec4::new(emitter.clock, distance, 0., 0.);
        if let Some((_, handle)) = state.entries.get(&root) {
            if let Some(mut m) = materials.get_mut(handle) {
                m.parameters = parameters;
                m.tuning = v;
            }
        } else {
            let handle = materials.add(SolarSurfaceMaterial {
                parameters,
                tuning: v,
            });
            let child = commands
                .spawn((
                    Mesh3d(shared.mesh.clone()),
                    MeshMaterial3d(handle.clone()),
                    Transform::from_scale(Vec3::splat(1.0001)),
                    ChildOf(root),
                ))
                .id();
            state.entries.insert(root, (child, handle));
        }
    }
    state.entries.retain(|root, (child, handle)| {
        if keep.contains(root) {
            return true;
        }
        commands.entity(*child).try_despawn();
        materials.remove(handle.id());
        false
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distance_hysteresis_rejects_invalid_camera() {
        assert!(near(8., false, 9., 11.));
        assert!(near(10., true, 9., 11.));
        assert!(!near(10., false, 9., 11.));
        assert!(!near(f32::INFINITY, true, 9., 11.));
        assert!(!near(f32::NAN, true, 9., 11.));
        assert!(!near(-1., true, 9., 11.));
    }
    fn fixture() -> (App, Entity, Entity, Handle<StandardMaterial>, Handle<Mesh>) {
        let mut app = App::new();
        app.init_resource::<Assets<Mesh>>()
            .init_resource::<Assets<StandardMaterial>>()
            .init_resource::<Assets<SolarSurfaceMaterial>>()
            .init_resource::<SolarSurfaceLod>()
            .add_systems(Update, sync_solar_surface);
        let mesh = app
            .world_mut()
            .resource_mut::<Assets<Mesh>>()
            .add(Sphere::new(1.).mesh().uv(16, 8));
        app.insert_resource(crate::render_assets::SharedVisuals { mesh: mesh.clone() });
        let original = app
            .world_mut()
            .resource_mut::<Assets<StandardMaterial>>()
            .add(StandardMaterial::default());
        let mut tuning = [Vec4::ZERO; 19];
        for (i, value) in [(0, 1.), (55, 8.), (56, 10.), (72, 1.)] {
            tuning[i / 4][i % 4] = value;
        }
        let root = app
            .world_mut()
            .spawn((
                GlobalTransform::IDENTITY,
                Visibility::Visible,
                MeshMaterial3d(original.clone()),
                crate::stellar_render::StellarEmitter {
                    source: "sun".into(),
                    parameters: Vec4::ZERO,
                    clock: 0.,
                    current_settings: tuning,
                },
            ))
            .id();
        let camera = app
            .world_mut()
            .spawn((
                crate::renderer::DisplayCamera,
                GlobalTransform::from_translation(Vec3::Z * 4.),
            ))
            .id();
        (app, root, camera, original, mesh)
    }
    #[test]
    fn app_near_far_style_and_source_lifecycle_preserve_shared_mesh() {
        let (mut app, root, camera, original, mesh) = fixture();
        app.update();
        let (child, material) = app.world().resource::<SolarSurfaceLod>().entries[&root].clone();
        assert!(app.world().get_entity(child).is_ok());
        assert_eq!(
            app.world().resource::<Assets<SolarSurfaceMaterial>>().len(),
            1
        );
        assert_eq!(
            app.world()
                .resource::<Assets<StandardMaterial>>()
                .get(&original)
                .unwrap()
                .base_color
                .alpha(),
            0.
        );
        *app.world_mut().get_mut::<GlobalTransform>(camera).unwrap() =
            GlobalTransform::from_translation(Vec3::Z * 12.);
        app.update();
        assert!(app.world().resource::<SolarSurfaceLod>().entries.is_empty());
        assert!(app.world().get_entity(child).is_err());
        assert!(
            app.world()
                .resource::<Assets<SolarSurfaceMaterial>>()
                .get(&material)
                .is_none()
        );
        assert!(app.world().resource::<Assets<Mesh>>().get(&mesh).is_some());
        assert_eq!(
            app.world()
                .resource::<Assets<StandardMaterial>>()
                .get(&original)
                .unwrap()
                .base_color
                .alpha(),
            1.
        );
        *app.world_mut().get_mut::<GlobalTransform>(camera).unwrap() =
            GlobalTransform::from_translation(Vec3::Z * 4.);
        app.update();
        app.world_mut()
            .get_mut::<crate::stellar_render::StellarEmitter>(root)
            .unwrap()
            .current_settings[18]
            .x = 0.;
        app.update();
        assert!(app.world().resource::<SolarSurfaceLod>().entries.is_empty());
        app.world_mut()
            .get_mut::<crate::stellar_render::StellarEmitter>(root)
            .unwrap()
            .current_settings[18]
            .x = 1.;
        app.update();
        let (child, material) = app.world().resource::<SolarSurfaceLod>().entries[&root].clone();
        app.world_mut().despawn(root);
        app.update();
        assert!(app.world().resource::<SolarSurfaceLod>().entries.is_empty());
        assert!(app.world().get_entity(child).is_err());
        assert!(
            app.world()
                .resource::<Assets<SolarSurfaceMaterial>>()
                .get(&material)
                .is_none()
        );
        assert!(app.world().resource::<Assets<Mesh>>().get(&mesh).is_some());
    }
    #[test]
    fn app_masks_only_original_pixels_and_rejects_ambiguous_camera() {
        let (mut app, root, _, original, _) = fixture();
        let sibling = app
            .world_mut()
            .spawn((Visibility::Inherited, ChildOf(root)))
            .id();
        app.update();
        assert_eq!(
            *app.world().get::<Visibility>(root).unwrap(),
            Visibility::Visible
        );
        assert_eq!(
            *app.world().get::<Visibility>(sibling).unwrap(),
            Visibility::Inherited
        );
        assert!(matches!(
            app.world()
                .resource::<Assets<StandardMaterial>>()
                .get(&original)
                .unwrap()
                .alpha_mode,
            AlphaMode::Mask(_)
        ));
        app.world_mut()
            .spawn((crate::renderer::DisplayCamera, GlobalTransform::IDENTITY));
        app.update();
        assert!(app.world().resource::<SolarSurfaceLod>().entries.is_empty());
        assert!(app.world().get_entity(sibling).is_ok());
        assert_eq!(
            app.world()
                .resource::<Assets<StandardMaterial>>()
                .get(&original)
                .unwrap()
                .base_color
                .alpha(),
            1.
        );
    }
}
