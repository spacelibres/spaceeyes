use bevy::prelude::*;
#[derive(Resource, Default, Debug)]
pub(crate) struct DeepSpaceLod {
    pub wanted: u32,
    pub ready: u32,
    pub current: u32,
    pub blend: f32,
    pub exposure: f32,
    pub black: f32,
    initialized: bool,
    pub effective_target: Option<u32>,
}
impl DeepSpaceLod {
    pub fn desired(fov: f32, height: f32) -> u32 {
        ((height * 360.0 / fov.max(10.0) / 128.0).log2().ceil() as u32).min(6)
    }
}
pub(crate) fn update_lod(
    mut lod: ResMut<DeepSpaceLod>,
    cameras: Query<(&Projection, &Camera), With<crate::renderer::DisplayCamera>>,
) {
    let Ok((Projection::Perspective(p), c)) = cameras.single() else {
        return;
    };
    let wanted = DeepSpaceLod::desired(
        p.fov.to_degrees(),
        c.physical_viewport_size().map_or(720.0, |v| v.y as f32),
    );
    let density = c.physical_viewport_size().map_or(720.0, |v| v.y as f32) * 360.0
        / p.fov.to_degrees().max(10.0)
        / 128.0;
    let keep = lod.initialized && keep_level(lod.wanted, wanted, density);
    lod.initialized = true;
    if wanted != lod.wanted && !keep {
        lod.blend = 0.0;
        lod.ready = lod.current;
        lod.wanted = wanted;
    }
}

fn keep_level(current: u32, wanted: u32, density: f32) -> bool {
    if wanted > current {
        density < 2f32.powi(current as i32) * 1.1
    } else if wanted < current {
        density > 2f32.powi(current as i32 - 1) * 0.9
    } else {
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn density_hysteresis_prevents_boundary_chatter() {
        assert!(keep_level(3, 4, 8.05));
        assert!(keep_level(4, 3, 7.95));
        assert!(!keep_level(3, 4, 9.0));
        assert!(!keep_level(4, 3, 7.0));
        assert_eq!(DeepSpaceLod::desired(10., 720.), 6);
        assert!(DeepSpaceLod::desired(100., 720.) < DeepSpaceLod::desired(10., 720.));
    }
}
