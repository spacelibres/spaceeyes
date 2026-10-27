// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded, indexed UV sphere topology. Vertices lie on the unit sphere.
use crate::RenderError;
pub const SPHERE_SLICES: u32 = 32;
pub const SPHERE_STACKS: u32 = 16;
pub const SPHERE_DRAW_VERTICES: u32 = SPHERE_SLICES * (SPHERE_STACKS - 1) * 6;
#[derive(Clone, Copy, Debug)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
}
#[derive(Clone, Debug)]
pub struct SphereMesh {
    pub vertices: Vec<MeshVertex>,
    pub indices: Vec<u32>,
}
pub fn unit_sphere(slices: u32, stacks: u32) -> Result<SphereMesh, RenderError> {
    if !(3..=128).contains(&slices) || !(2..=64).contains(&stacks) {
        return Err(RenderError::InvalidMesh);
    }
    let mut vertices = Vec::with_capacity(((slices + 1) * (stacks + 1)) as usize);
    for y in 0..=stacks {
        let theta = std::f64::consts::PI * f64::from(y) / f64::from(stacks);
        for x in 0..=slices {
            let phi = std::f64::consts::TAU * f64::from(x) / f64::from(slices);
            let p = [
                (theta.sin() * phi.cos()) as f32,
                theta.cos() as f32,
                (theta.sin() * phi.sin()) as f32,
            ];
            vertices.push(MeshVertex {
                position: p,
                normal: p,
                uv: [x as f32 / slices as f32, y as f32 / stacks as f32],
            });
        }
    }
    let mut indices = Vec::with_capacity((slices * (stacks - 1) * 6) as usize);
    for y in 0..stacks {
        for x in 0..slices {
            let a = y * (slices + 1) + x;
            let b = a + slices + 1;
            if y != 0 {
                indices.extend_from_slice(&[a, a + 1, b]);
            }
            if y != stacks - 1 {
                indices.extend_from_slice(&[a + 1, b + 1, b]);
            }
        }
    }
    Ok(SphereMesh { vertices, indices })
}
