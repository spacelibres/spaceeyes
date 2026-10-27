// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Prepared sphere draws and picking against exactly the tessellation used for rendering.
use crate::{mesh, DrawMaterial, RenderError, View};
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
pub struct Perspective {
    half: f64,
    aspect: f64,
    near: f64,
    far: f64,
}
impl Perspective {
    pub(crate) fn from_view(view: View) -> Result<Self, RenderError> {
        view.validate()?;
        let result = Self {
            half: (view.vertical_fov_radians * 0.5).tan(),
            aspect: view.aspect,
            near: view.near_m,
            far: view.far_m,
        };
        let a = result.far / (result.far - result.near);
        if ![result.half, a, a * result.near]
            .iter()
            .all(|x| x.is_finite())
            || result.half <= 0.0
        {
            return Err(RenderError::InvalidCamera);
        }
        Ok(result)
    }
    #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
    pub(crate) fn clip(self, p: [f64; 3]) -> Result<[f32; 4], RenderError> {
        let d = -p[2];
        let a = self.far / (self.far - self.near);
        let clip = [
            p[0] / (self.half * self.aspect),
            p[1] / self.half,
            a * (d - self.near),
            d,
        ];
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
    pub(crate) fn ray(self, x: f64, y: f64) -> [f64; 3] {
        [x * self.half * self.aspect, y * self.half, -1.0]
    }
    pub(crate) fn pick_depth(
        self,
        sphere: &SphereDraw,
        x: f64,
        y: f64,
        mesh: &mesh::SphereMesh,
    ) -> Option<f64> {
        let ray = [x * self.half * self.aspect, y * self.half, -1.0];
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
                std::array::from_fn(|axis| sphere.center_camera[axis] + p[axis] * sphere.radius_m)
            };
            let a = vertex(triangle[0]);
            let b = vertex(triangle[1]);
            let c = vertex(triangle[2]);
            if let Some(t) = ray_triangle(ray, a, b, c) {
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
