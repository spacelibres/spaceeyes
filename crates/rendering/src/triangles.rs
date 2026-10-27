// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Read-only triangle draws use exactly the model transform shared with picking.
use crate::{sphere::ray_triangle, DrawMaterial, Perspective};
use spaceeyes_foundation::ObjectId;
use spaceeyes_geometry::TriangleMesh;
use spaceeyes_spatial::{RigidTransform, Vec3d};
use std::sync::Arc;
#[derive(Clone, Debug)]
pub struct MeshDraw {
    pub object: ObjectId,
    pub geometry: Arc<TriangleMesh>,
    pub object_to_camera: RigidTransform,
    pub material: DrawMaterial,
}
impl MeshDraw {
    pub(crate) fn point(&self, index: u32) -> [f64; 3] {
        let [x, y, z] = self.geometry.vertices()[index as usize].position_m();
        let point = self.object_to_camera.apply(Vec3d { x, y, z });
        [point.x, point.y, point.z]
    }
    pub(crate) fn pick_depth(&self, projection: Perspective, x: f64, y: f64) -> Option<f64> {
        let ray = projection.ray(x, y);
        let origin = projection.ray_origin(x, y);
        let offset = |p: [f64; 3]| std::array::from_fn(|axis| p[axis] - origin[axis]);
        let mut closest = f64::INFINITY;
        for triangle in self.geometry.indices().as_chunks::<3>().0 {
            let [a, b, c] = triangle.map(|i| offset(self.point(i)));
            if let Some(t) = ray_triangle(ray, a, b, c) {
                if t >= projection.near() && t <= projection.far() && t < closest {
                    closest = t;
                }
            }
        }
        closest.is_finite().then(|| projection.depth(closest))
    }
}
