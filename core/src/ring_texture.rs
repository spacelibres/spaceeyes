//! Expand NASA radial ring strips into transparent plane textures; built-in Bevy geometry/PBR.
use crate::{VisualPhase, runtime::CoreStore};
use bevy::{
    asset::RenderAssetUsages,
    pbr::{ExtendedMaterial, MaterialExtension},
    prelude::*,
    render::render_resource::{AsBindGroup, Extent3d, Face, TextureDimension, TextureFormat},
    shader::ShaderRef,
};

pub(crate) type RingMaterial = ExtendedMaterial<StandardMaterial, RingParticles>;
#[derive(Asset, AsBindGroup, Reflect, Debug, Clone)]
pub(crate) struct RingParticles {
    #[uniform(100)]
    particle_response: Vec4,
}
impl MaterialExtension for RingParticles {
    fn fragment_shader() -> ShaderRef {
        "shaders/ring-particles.wgsl".into()
    }
}
#[derive(Component)]
pub(crate) struct PendingRing {
    pub pixels: Vec<u8>,
    pub next_row: u32,
    pub object: String,
    pub revision: u64,
    pub image: Handle<Image>,
    pub opacity_image: Handle<Image>,
    pub inner: f32,
    pub outer: f32,
    pub bottom: bool,
}
pub(crate) fn resolve_rings(
    mut commands: Commands,
    store: Res<CoreStore>,
    server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<RingMaterial>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut rings: Query<(Entity, &mut PendingRing)>,
) {
    let Ok(mut core) = store.0.lock() else {
        return;
    };
    let mut converted_this_frame = false;
    for (entity, mut ring) in &mut rings {
        if core
            .visual_assignment(&ring.object)
            .is_none_or(|v| v.revision != ring.revision)
        {
            commands.entity(entity).despawn();
            continue;
        }
        if core
            .visual_status(&ring.object)
            .ok()
            .flatten()
            .is_some_and(|status| status.phase == VisualPhase::Failed)
        {
            commands.entity(entity).remove::<PendingRing>();
            continue;
        }
        if [&ring.image, &ring.opacity_image].iter().any(|image| {
            matches!(
                server.get_load_state(image.id()),
                Some(bevy::asset::LoadState::Failed(_))
            )
        }) {
            core.record_visual_status(
                &ring.object,
                ring.revision,
                VisualPhase::Failed,
                Some("ring texture load failed".into()),
            );
            commands.entity(entity).remove::<PendingRing>();
            continue;
        }
        let Some(source) = images.get(&ring.image) else {
            continue;
        };
        let Some(opacity) = images.get(&ring.opacity_image) else {
            continue;
        };
        let size = source.size();
        if size.x == 0 || size.y == 0 || opacity.width() == 0 {
            continue;
        }
        if converted_this_frame {
            continue;
        }
        converted_this_frame = true;
        let width = 1024u32;
        if ring.pixels.is_empty() {
            ring.pixels.resize((width * width * 4) as usize, 0);
        }
        let start = ring.next_row;
        let end = (start + 16).min(width);
        let inner = ring.inner;
        let outer = ring.outer;
        let pixels = &mut ring.pixels;
        let mut failed = false;
        for y in start..end {
            for x in 0..width {
                let p = Vec2::new(
                    (x as f32 + 0.5) / width as f32 * 2. - 1.,
                    (y as f32 + 0.5) / width as f32 * 2. - 1.,
                );
                let r = p.length() * outer;
                if r < inner || r > outer {
                    continue;
                }
                let u = (r - inner) / (outer - inner);
                match crate::face_texture::rgba_pixel(
                    source,
                    (u * (size.x - 1) as f32).round() as u32,
                    0,
                ) {
                    Ok(c) => {
                        let i = ((y * width + x) * 4) as usize;
                        match crate::face_texture::rgba_pixel(
                            opacity,
                            (u * (opacity.width() - 1) as f32).round() as u32,
                            0,
                        ) {
                            Ok(alpha) => pixels[i..i + 4].copy_from_slice(&ring_pixel(c, alpha)),
                            Err(_) => {
                                failed = true;
                                break;
                            }
                        }
                    }
                    Err(_) => {
                        failed = true;
                        break;
                    }
                }
            }
            if failed {
                break;
            }
        }
        if failed {
            core.record_visual_status(
                &ring.object,
                ring.revision,
                VisualPhase::Failed,
                Some("ring texture pixel decode failed".into()),
            );
            commands.entity(entity).remove::<PendingRing>();
            continue;
        }
        ring.next_row = end;
        if end < width {
            continue;
        }
        let image = images.add(Image::new(
            Extent3d {
                width,
                height: width,
                depth_or_array_layers: 1,
            },
            TextureDimension::D2,
            std::mem::take(&mut ring.pixels),
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::default(),
        ));
        let material = materials.add(ExtendedMaterial {
            base: StandardMaterial {
                base_color_texture: Some(image),
                alpha_mode: AlphaMode::Blend,
                cull_mode: Some(Face::Back),
                perceptual_roughness: 1.,
                ..default()
            },
            extension: RingParticles {
                particle_response: Vec4::ONE,
            },
        });
        core.record_visual_part_ready(
            &ring.object,
            ring.revision,
            if ring.bottom {
                "ring-bottom"
            } else {
                "ring-top"
            },
        );
        commands
            .entity(entity)
            .insert((
                Mesh3d(
                    meshes.add(
                        Plane3d::default()
                            .mesh()
                            .size(ring.outer * 2., ring.outer * 2.),
                    ),
                ),
                MeshMaterial3d(material),
                Transform::from_rotation(if ring.bottom {
                    Quat::from_rotation_x(std::f32::consts::PI)
                } else {
                    Quat::IDENTITY
                }),
                Visibility::Inherited,
            ))
            .remove::<PendingRing>();
    }
}

fn ring_pixel(color: [u8; 4], top: [u8; 4]) -> [u8; 4] {
    [color[0], color[1], color[2], top[3]]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gray_bottom_uses_top_opacity_including_transparent_gaps() {
        assert_eq!(
            ring_pixel([60, 60, 60, 255], [220, 210, 200, 0]),
            [60, 60, 60, 0]
        );
        assert_eq!(
            ring_pixel([60, 60, 60, 255], [220, 210, 200, 100]),
            [60, 60, 60, 100]
        );
    }
}
