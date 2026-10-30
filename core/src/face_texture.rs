//! NASA recovered CubeMap face frames, converted once into Bevy UV-sphere texture.
use crate::{VisualPhase, runtime::CoreStore};
use bevy::{
    asset::RenderAssetUsages,
    prelude::*,
    render::render_resource::{Extent3d, TextureDimension, TextureFormat},
};
#[derive(Resource, Default)]
pub(crate) struct FaceCache(std::collections::VecDeque<(Vec<AssetId<Image>>, Handle<Image>)>);
// Bounds cache-owned generated payload only; active materials retain their own handles.
const GENERATED_TEXTURE_BYTES: usize = 2048 * 1024 * 4;
const FACE_CACHE_BYTES: usize = 64 * 1024 * 1024;
impl FaceCache {
    fn get(&self, key: &[AssetId<Image>]) -> Option<&Handle<Image>> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, h)| h)
    }
    fn insert(&mut self, key: Vec<AssetId<Image>>, handle: Handle<Image>) {
        if let Some(index) = self.0.iter().position(|(k, _)| *k == key) {
            self.0.remove(index);
        }
        while self.0.len() >= FACE_CACHE_BYTES / GENERATED_TEXTURE_BYTES {
            self.0.pop_front();
        }
        self.0.push_back((key, handle));
    }
    fn clear(&mut self) {
        self.0.clear();
    }
}
#[derive(Component)]
pub(crate) struct PendingFaces {
    pub pixels: Vec<u8>,
    pub next_row: u32,
    pub object: String,
    pub revision: u64,
    pub handles: [Handle<Image>; 6],
    pub material: Handle<StandardMaterial>,
}
// Recovered CubeMap.js default frames: U, V, outward normal; later face wins ties.
#[cfg(test)]
fn face_uv_reference(d: Vec3) -> (usize, f32, f32) {
    let frames = [
        (Vec3::Y, Vec3::Z, Vec3::X),
        (-Vec3::X, Vec3::Z, Vec3::Y),
        (-Vec3::Y, Vec3::Z, -Vec3::X),
        (Vec3::X, Vec3::Z, -Vec3::Y),
        (Vec3::Y, -Vec3::X, Vec3::Z),
        (Vec3::Y, Vec3::X, -Vec3::Z),
    ];
    let mut result = (0, 0.5, 0.5);
    let dominant = d.abs().max_element();
    for (i, (u, v, n)) in frames.into_iter().enumerate() {
        let projection = d.dot(n);
        if projection >= dominant {
            result = (
                i,
                0.5 * (d.dot(u) / projection + 1.0),
                0.5 * (d.dot(v) / projection + 1.0),
            );
        }
    }
    result
}
fn face_uv(d: Vec3) -> (usize, f32, f32) {
    let a = d.abs();
    let (face, u, v, n) = if a.z >= a.x && a.z >= a.y {
        if d.z >= 0.0 {
            (4, d.y, -d.x, d.z)
        } else {
            (5, d.y, d.x, -d.z)
        }
    } else if a.x > a.y || (a.x == a.y && d.x < 0.0 && d.y >= 0.0) {
        if d.x >= 0.0 {
            (0, d.y, d.z, d.x)
        } else {
            (2, -d.y, d.z, -d.x)
        }
    } else if d.y >= 0.0 {
        (1, -d.x, d.z, d.y)
    } else {
        (3, d.x, d.z, -d.y)
    };
    (face, 0.5 * (u / n + 1.0), 0.5 * (v / n + 1.0))
}
pub(crate) fn rgba_pixel(image: &Image, x: u32, y: u32) -> Result<[u8; 4], String> {
    if image.texture_descriptor.format == TextureFormat::Rgba8UnormSrgb {
        let i = ((y * image.width() + x) * 4) as usize;
        if let Some(pixel) = image.data.as_ref().and_then(|d| d.get(i..i + 4)) {
            return Ok([pixel[0], pixel[1], pixel[2], pixel[3]]);
        }
    }
    image
        .get_color_at(x, y)
        .map(|c| c.to_srgba().to_u8_array())
        .map_err(|e| format!("{e:?}"))
}
fn convert_rows(
    faces: [&Image; 6],
    data: &mut Vec<u8>,
    next_row: &mut u32,
    rows: u32,
) -> Result<Option<Image>, String> {
    let width = 2048u32;
    let height = 1024u32;
    if data.is_empty() {
        data.reserve_exact((width * height * 4) as usize);
    }
    let longitude: Vec<_> = (0..width)
        .map(|x| {
            let lon = (x as f32 + 0.5) / width as f32 * std::f32::consts::TAU;
            (lon.cos(), lon.sin())
        })
        .collect();
    let end = next_row.saturating_add(rows).min(height);
    for y in *next_row..end {
        let lat =
            std::f32::consts::FRAC_PI_2 - (y as f32 + 0.5) / height as f32 * std::f32::consts::PI;
        let lat_cos = lat.cos();
        let lat_sin = lat.sin();
        for &(lon_cos, lon_sin) in &longitude {
            // Bevy UV Sphere produces z-up vertices; invert display x,z,-y basis.
            let display = Vec3::new(lat_cos * lon_cos, lat_cos * lon_sin, lat_sin);
            let (face, u, v) = face_uv(Vec3::new(display.x, -display.z, display.y));
            let image = faces[face];
            let size = image.size();
            if size.x == 0 || size.y == 0 {
                return Err("empty face image".into());
            }
            // SpheroidLODComponent.js:371-372 writes UV=(column, 1-row).
            let px = (u.clamp(0.0, 1.0) * (size.x - 1) as f32).round() as u32;
            let py = ((1.0 - v.clamp(0.0, 1.0)) * (size.y - 1) as f32).round() as u32;
            let c = rgba_pixel(image, px, py)?;
            data.extend_from_slice(&c);
        }
    }
    *next_row = end;
    if end < height {
        return Ok(None);
    }
    Ok(Some(Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        std::mem::take(data),
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    )))
}
pub(crate) fn resolve_faces(
    mut commands: Commands,
    store: Res<CoreStore>,
    server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut cache: ResMut<FaceCache>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut roots: Query<(Entity, &mut PendingFaces, &mut Visibility)>,
) {
    let Ok(mut core) = store.0.lock() else {
        return;
    };
    if core.object_ids().next().is_none() {
        cache.clear();
    }
    let mut converted_this_frame = false;
    let mut order: Vec<_> = roots
        .iter()
        .map(|(entity, pending, _)| {
            (
                entity,
                core.focused_object() != Some(pending.object.as_str()),
            )
        })
        .collect();
    order.sort_by_key(|(_, not_focused)| *not_focused);
    for (entity, _) in order {
        let Ok((_, mut pending, mut visibility)) = roots.get_mut(entity) else {
            continue;
        };
        if core
            .visual_assignment(&pending.object)
            .is_none_or(|v| v.revision != pending.revision)
        {
            commands.entity(entity).despawn();
            continue;
        }
        if core
            .visual_status(&pending.object)
            .ok()
            .flatten()
            .is_some_and(|status| status.phase == VisualPhase::Failed)
        {
            commands.entity(entity).remove::<PendingFaces>();
            continue;
        }
        if pending.handles.iter().any(|h| {
            matches!(
                server.get_load_state(h.id()),
                Some(bevy::asset::LoadState::Failed(_))
            )
        }) {
            core.record_visual_status(
                &pending.object,
                pending.revision,
                VisualPhase::Failed,
                Some("six-face texture load failed".into()),
            );
            commands.entity(entity).remove::<PendingFaces>();
            continue;
        }
        let key: Vec<_> = pending.handles.iter().map(Handle::id).collect();
        if let Some(handle) = cache.get(&key) {
            if let Some(mut material) = materials.get_mut(&pending.material) {
                material.base_color_texture = Some(handle.clone());
                material.emissive_texture = Some(handle.clone());
            }
            *visibility = Visibility::Inherited;
            commands.entity(entity).remove::<PendingFaces>();
            core.record_visual_status(&pending.object, pending.revision, VisualPhase::Ready, None);
            continue;
        }
        let loaded: Option<Vec<_>> = pending.handles.iter().map(|h| images.get(h)).collect();
        let Some(loaded) = loaded else {
            continue;
        };
        if converted_this_frame {
            continue;
        }
        converted_this_frame = true;
        let PendingFaces {
            pixels, next_row, ..
        } = &mut *pending;
        match convert_rows(
            [
                loaded[0], loaded[1], loaded[2], loaded[3], loaded[4], loaded[5],
            ],
            pixels,
            next_row,
            16,
        ) {
            Ok(None) => {}
            Ok(Some(image)) => {
                let handle = images.add(image);
                cache.insert(key, handle.clone());
                if let Some(mut material) = materials.get_mut(&pending.material) {
                    material.base_color_texture = Some(handle.clone());
                    material.emissive_texture = Some(handle);
                }
                *visibility = Visibility::Inherited;
                commands.entity(entity).remove::<PendingFaces>();
                core.record_visual_status(
                    &pending.object,
                    pending.revision,
                    VisualPhase::Ready,
                    None,
                );
            }
            Err(error) => {
                core.record_visual_status(
                    &pending.object,
                    pending.revision,
                    VisualPhase::Failed,
                    Some(error),
                );
                commands.entity(entity).remove::<PendingFaces>();
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cardinal_face_order() {
        for (i, d) in [Vec3::X, Vec3::Y, -Vec3::X, -Vec3::Y, Vec3::Z, -Vec3::Z]
            .into_iter()
            .enumerate()
        {
            assert_eq!(face_uv(d), (i, 0.5, 0.5));
        }
    }
}

#[cfg(test)]
mod batching_tests {
    use super::*;
    fn source() -> Image {
        Image::new(
            Extent3d {
                width: 2,
                height: 2,
                depth_or_array_layers: 1,
            },
            TextureDimension::D2,
            vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
            ],
            TextureFormat::Rgba8UnormSrgb,
            RenderAssetUsages::default(),
        )
    }
    #[test]
    fn row_batches_match_full_conversion_and_publish_only_at_end() {
        let source = source();
        let faces = [&source; 6];
        let mut expected_pixels = Vec::new();
        let mut expected_row = 0;
        let expected = convert_rows(faces, &mut expected_pixels, &mut expected_row, 1024)
            .unwrap()
            .unwrap();
        let mut pixels = Vec::new();
        let mut row = 0;
        assert!(
            convert_rows(faces, &mut pixels, &mut row, 64)
                .unwrap()
                .is_none()
        );
        assert_eq!(row, 64);
        assert_eq!(pixels.len(), 64 * 2048 * 4);
        while row < 960 {
            assert!(
                convert_rows(faces, &mut pixels, &mut row, 64)
                    .unwrap()
                    .is_none()
            );
        }
        let actual = convert_rows(faces, &mut pixels, &mut row, 64)
            .unwrap()
            .unwrap();
        assert_eq!(row, 1024);
        assert!(pixels.is_empty());
        assert_eq!(actual.data, expected.data);
        assert_eq!(actual.asset_usage, RenderAssetUsages::RENDER_WORLD);
    }
    #[test]
    fn rgba_source_fast_path_preserves_exact_bytes() {
        let source = source();
        assert_eq!(rgba_pixel(&source, 0, 1).unwrap(), [0, 0, 255, 255]);
    }
}

#[cfg(test)]
mod closed_face_tests {
    use super::*;
    #[test]
    fn closed_mapping_preserves_reference_uv_and_later_face_ties() {
        for x in [-2.0, -1.0, 0.0, 1.0, 2.0] {
            for y in [-2.0, -1.0, 0.0, 1.0, 2.0] {
                for z in [-2.0, -1.0, 0.0, 1.0, 2.0] {
                    let d = Vec3::new(x, y, z);
                    if d == Vec3::ZERO {
                        continue;
                    }
                    let actual = face_uv(d);
                    let expected = face_uv_reference(d);
                    assert_eq!(actual.0, expected.0, "{d:?}");
                    assert!((actual.1 - expected.1).abs() < 1e-6);
                    assert!((actual.2 - expected.2).abs() < 1e-6);
                }
            }
        }
        assert_eq!(face_uv(Vec3::new(-1., 1., 0.)).0, 2);
        assert_eq!(face_uv(Vec3::new(-1., -1., 0.)).0, 3);
        assert_eq!(face_uv(Vec3::new(1., 1., 1.)).0, 4);
        assert_eq!(face_uv(Vec3::new(1., 1., -1.)).0, 5);
    }
}

#[cfg(test)]
mod cache_tests {
    use super::*;
    #[test]
    fn fifo_budget_reuse_and_clear_preserve_material_assets() {
        let mut images = Assets::<Image>::default();
        let mut cache = FaceCache::default();
        let handles: Vec<_> = (0..9).map(|_| images.add(Image::default())).collect();
        let key = |i: usize| vec![handles[i].id()];
        let mut material = StandardMaterial::default();
        material.base_color_texture = Some(handles[0].clone());
        for i in 0..8 {
            cache.insert(key(i), handles[i].clone());
        }
        assert_eq!(cache.get(&key(0)), Some(&handles[0]));
        cache.insert(key(8), handles[8].clone());
        assert!(cache.get(&key(0)).is_none());
        assert_eq!(cache.get(&key(1)), Some(&handles[1]));
        assert_eq!(cache.0.len() * GENERATED_TEXTURE_BYTES, FACE_CACHE_BYTES);
        cache.insert(key(8), handles[8].clone());
        assert_eq!(cache.0.len(), 8);
        cache.clear();
        assert!(cache.0.is_empty());
        assert!(
            images
                .get(material.base_color_texture.as_ref().unwrap())
                .is_some()
        );
    }
}
