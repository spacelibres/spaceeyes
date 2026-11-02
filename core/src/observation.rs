//! Shared projection units for annotations, hit rays and deep-space LOD.
//! Construct only after Bevy updates the camera's viewport/projection for this frame.
use crate::picking::PickRay;
use bevy::prelude::*;

pub(crate) struct ObservationProjection {
    pub logical_size: Vec2,
    pub physical_size: Vec2,
    vertical: f32,
    aspect: f32,
}
impl ObservationProjection {
    pub fn from_camera(camera: &Camera, projection: &Projection) -> Option<Self> {
        let Projection::Perspective(p) = projection else {
            return None;
        };
        if !camera.is_active {
            return None;
        }
        let logical_size = camera.logical_viewport_size()?;
        let physical_size = camera.physical_viewport_size()?.as_vec2();
        if !p.fov.is_finite()
            || !(0.0..std::f32::consts::PI).contains(&p.fov)
            || p.fov == 0.
            || !p.aspect_ratio.is_finite()
            || p.aspect_ratio <= 0.
            || !logical_size.is_finite()
            || logical_size.min_element() <= 0.
            || !physical_size.is_finite()
            || physical_size.min_element() <= 0.
        {
            return None;
        }
        Some(Self {
            logical_size,
            physical_size,
            vertical: p.fov,
            aspect: p.aspect_ratio,
        })
    }
    pub fn sky_density(&self) -> f32 {
        Self::density(self.vertical.to_degrees(), self.physical_size.y)
    }
    pub fn vertical_degrees(&self) -> f32 {
        self.vertical.to_degrees()
    }
    pub fn density(vertical_degrees: f32, physical_height: f32) -> f32 {
        if !vertical_degrees.is_finite()
            || vertical_degrees <= 0.
            || vertical_degrees >= 180.
            || !physical_height.is_finite()
            || physical_height <= 0.
        {
            return 0.;
        }
        physical_height * 360. / vertical_degrees / 128.
    }
    pub fn pick_ray(&self, pose: &GlobalTransform) -> Option<PickRay> {
        if !pose.affine().is_finite() {
            return None;
        }
        Some(PickRay {
            origin: pose.translation().as_dvec3().to_array(),
            forward: (*pose.forward()).as_dvec3().to_array(),
            right_half: ((*pose.right()).as_dvec3()
                * ((self.vertical as f64 * 0.5).tan() * self.aspect as f64))
                .to_array(),
            up_half: ((*pose.up()).as_dvec3() * (self.vertical as f64 * 0.5).tan()).to_array(),
        })
    }
    pub fn radius_pixels(
        &self,
        camera: &Camera,
        pose: &GlobalTransform,
        center: Vec3,
        radius: f32,
    ) -> f32 {
        if !radius.is_finite() || radius <= 0. {
            return 0.;
        }
        // Keep Bevy's near/far validation and actual computed projection, including DPI.
        let Ok(pixel) = camera.world_to_viewport(pose, center) else {
            return 0.;
        };
        camera
            .world_to_viewport(pose, center + pose.right() * radius)
            .map_or(0., |offset| offset.distance(pixel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy::camera::{CameraProjection, RenderTargetInfo};
    fn camera(fov: f32, physical: UVec2, dpi: f32) -> (Camera, Projection) {
        let p = PerspectiveProjection {
            fov: fov.to_radians(),
            aspect_ratio: physical.x as f32 / physical.y as f32,
            ..default()
        };
        let mut c = Camera::default();
        c.computed.target_info = Some(RenderTargetInfo {
            physical_size: physical,
            scale_factor: dpi,
        });
        c.computed.clip_from_view = p.get_clip_from_view();
        (c, Projection::Perspective(p))
    }
    #[test]
    fn dpi_changes_texture_density_without_changing_logical_labels_or_pick_angles() {
        let (a, pa) = camera(45., UVec2::new(1280, 720), 1.);
        let (b, pb) = camera(45., UVec2::new(2560, 1440), 2.);
        let a_projection = ObservationProjection::from_camera(&a, &pa).unwrap();
        let b_projection = ObservationProjection::from_camera(&b, &pb).unwrap();
        assert_eq!(a_projection.logical_size, b_projection.logical_size);
        assert_eq!(b_projection.sky_density(), a_projection.sky_density() * 2.);
        let pose = GlobalTransform::from(
            Transform::from_xyz(100., 20., 30.).with_rotation(Quat::from_rotation_y(0.7)),
        );
        let center = pose.translation() + *pose.forward() * 10.;
        let r = a_projection.radius_pixels(&a, &pose, center, 0.1);
        assert!((r - b_projection.radius_pixels(&b, &pose, center, 0.1)).abs() < 0.001);
        assert!(r > 8. && r < 9.);
        assert_eq!(
            a_projection.pick_ray(&pose).unwrap().right_half,
            b_projection.pick_ray(&pose).unwrap().right_half
        );
        assert_eq!(
            a_projection.radius_pixels(&a, &pose, pose.translation() - *pose.forward(), 1.),
            0.
        );
    }
    #[test]
    fn invalid_or_missing_viewport_never_creates_a_stale_observation() {
        assert!(
            ObservationProjection::from_camera(&Camera::default(), &Projection::default())
                .is_none()
        );
        let (mut c, mut p) = camera(5., UVec2::new(800, 100), 1.);
        assert_eq!(
            ObservationProjection::from_camera(&c, &p)
                .unwrap()
                .sky_density(),
            56.25
        );
        c.is_active = false;
        assert!(ObservationProjection::from_camera(&c, &p).is_none());
        c.is_active = true;
        if let Projection::Perspective(p) = &mut p {
            p.fov = f32::NAN;
        }
        assert!(ObservationProjection::from_camera(&c, &p).is_none());
    }
}
