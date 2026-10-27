// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Prepared sphere draws and picking against exactly the tessellation used for rendering.
use crate::{mesh, DrawMaterial, RenderError, View, ViewProjection};
use spaceeyes_foundation::ObjectId;
use spaceeyes_spatial::{RigidTransform, Vec3d};
#[derive(Clone, Debug)]
pub struct SphereDraw {
    pub object: ObjectId,
    pub center_camera: [f64; 3],
    pub radius_m: f64,
    pub material: DrawMaterial,
    pub rotation_to_camera: RigidTransform,
}
#[derive(Clone, Copy, Debug)]
enum Kind {
    Perspective { half: f64 },
    Orthographic { half_height: f64 },
}
#[derive(Clone, Copy, Debug)]
pub struct Perspective {
    kind: Kind,
    aspect: f64,
    near: f64,
    far: f64,
}
impl Perspective {
    pub(crate) fn from_view(view: View) -> Result<Self, RenderError> {
        view.validate()?;
        let kind = match view.projection {
            ViewProjection::Perspective {
                vertical_fov_radians,
            } => Kind::Perspective {
                half: (vertical_fov_radians * 0.5).tan(),
            },
            ViewProjection::Orthographic { half_height_m } => Kind::Orthographic {
                half_height: half_height_m,
            },
        };
        let result = Self {
            kind,
            aspect: view.aspect,
            near: view.near_m,
            far: view.far_m,
        };
        let a = result.far / (result.far - result.near);
        let scale_valid = match result.kind {
            Kind::Perspective { half } => half.is_finite() && half > 0.0,
            Kind::Orthographic { half_height } => half_height.is_finite() && half_height > 0.0,
        };
        if ![a, a * result.near].iter().all(|x| x.is_finite()) || !scale_valid {
            return Err(RenderError::InvalidCamera);
        }
        Ok(result)
    }
    #[cfg(feature = "gpu")]
    pub(crate) fn clip(self, p: [f64; 3]) -> Result<[f32; 4], RenderError> {
        let d = -p[2];
        let a = self.far / (self.far - self.near);
        let clip = match self.kind {
            Kind::Perspective { half } => [
                p[0] / (half * self.aspect),
                p[1] / half,
                a * (d - self.near),
                d,
            ],
            Kind::Orthographic { half_height } => [
                p[0] / (half_height * self.aspect),
                p[1] / half_height,
                self.depth(d),
                1.0,
            ],
        };
        if !clip
            .iter()
            .all(|v| v.is_finite() && v.abs() <= f64::from(f32::MAX))
        {
            return Err(RenderError::InvalidFrame);
        }
        Ok(clip.map(|v| v as f32))
    }
    pub(crate) fn depth(self, d: f64) -> f64 {
        self.far / (self.far - self.near) * (1.0 - self.near / d)
    }
    pub(crate) fn near(self) -> f64 {
        self.near
    }
    pub(crate) fn far(self) -> f64 {
        self.far
    }
    /// Normalized device coordinates for a camera-space point.
    pub(crate) fn ndc(self, x: f64, y: f64, z: f64) -> [f64; 2] {
        match self.kind {
            Kind::Perspective { half } => [x / (z * half * self.aspect), y / (z * half)],
            Kind::Orthographic { half_height } => {
                [x / (half_height * self.aspect), y / half_height]
            }
        }
    }
    /// Picking ray origin; orthographic rays start on the camera plane.
    pub(crate) fn ray_origin(self, x: f64, y: f64) -> [f64; 3] {
        match self.kind {
            Kind::Perspective { .. } => [0.0, 0.0, 0.0],
            Kind::Orthographic { half_height } => {
                [x * half_height * self.aspect, y * half_height, 0.0]
            }
        }
    }
    pub(crate) fn ray(self, x: f64, y: f64) -> [f64; 3] {
        match self.kind {
            Kind::Perspective { half } => [x * half * self.aspect, y * half, -1.0],
            Kind::Orthographic { .. } => [0.0, 0.0, -1.0],
        }
    }
    pub(crate) fn pick_depth(
        self,
        sphere: &SphereDraw,
        x: f64,
        y: f64,
        mesh: &mesh::SphereMesh,
    ) -> Option<f64> {
        let origin = self.ray_origin(x, y);
        let direction = self.ray(x, y);
        let mut closest = f64::INFINITY;
        for triangle in mesh.indices.as_chunks::<3>().0 {
            let vertex = |i: u32| {
                let [x, y, z] = mesh.vertices[i as usize].position;
                let p = sphere.rotation_to_camera.apply(Vec3d {
                    x: f64::from(x),
                    y: f64::from(y),
                    z: f64::from(z),
                });
                let p = [p.x, p.y, p.z];
                let world: [f64; 3] = std::array::from_fn(|axis| {
                    sphere.center_camera[axis] + p[axis] * sphere.radius_m
                });
                let offset: [f64; 3] = std::array::from_fn(|axis| world[axis] - origin[axis]);
                offset
            };
            let a = vertex(triangle[0]);
            let b = vertex(triangle[1]);
            let c = vertex(triangle[2]);
            if let Some(t) = ray_triangle(direction, a, b, c) {
                if t >= self.near && t <= self.far && t < closest {
                    closest = t;
                }
            }
        }
        closest.is_finite().then(|| self.depth(closest))
    }
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.into_iter().zip(b).map(|(a, b)| a * b).sum()
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub(crate) fn ray_triangle(ray: [f64; 3], a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> Option<f64> {
    let e1 = sub(b, a);
    let e2 = sub(c, a);
    let p = cross(ray, e2);
    let det = dot(e1, p);
    let scale = dot(e1, e1).sqrt() * dot(e2, e2).sqrt() * dot(ray, ray).sqrt();
    if !det.is_finite() || det.abs() <= 32.0 * f64::EPSILON * scale {
        return None;
    }
    let tvec = a.map(|v| -v);
    let u = dot(tvec, p) / det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(tvec, e1);
    let v = dot(ray, q) / det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = dot(e2, q) / det;
    (t.is_finite() && t > 0.0).then_some(t)
}

#[cfg(all(test, feature = "gpu"))]
mod tests {
    use super::*;

    #[test]
    fn orthographic_clip_uses_unit_w_and_monotonic_depth() {
        let view = View {
            origin_m: [0.0; 3],
            projection: ViewProjection::Orthographic { half_height_m: 2.0 },
            aspect: 2.0,
            near_m: 0.1,
            far_m: 100.0,
        };
        let projection = Perspective::from_view(view).unwrap();
        let near = projection.clip([1.5, 0.0, -5.0]).unwrap();
        let far = projection.clip([1.5, 0.0, -10.0]).unwrap();
        assert_eq!(near[3], 1.0);
        assert!((near[0] - 1.5 / 4.0).abs() < 1e-6);
        assert!(near[2] < far[2]);
        assert_eq!(projection.ndc(1.5, 0.0, 5.0), [0.375, 0.0]);
    }
}
