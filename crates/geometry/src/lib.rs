// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Validated immutable local triangle geometry, independent of graphics backends and Proto.
use spaceeyes_foundation::CoreError;
pub const MAX_VERTICES: usize = 65_536;
pub const MAX_INDICES: usize = 196_608;
#[derive(Clone, Debug, PartialEq)]
pub struct Vertex {
    position_m: [f64; 3],
    normal: [f64; 3],
}
impl Eq for Vertex {}
impl Vertex {
    pub fn new(position_m: [f64; 3], normal: [f64; 3]) -> Result<Self, CoreError> {
        if !position_m.iter().all(|p| p.is_finite() && p.abs() <= 1e12)
            || !normal.iter().all(|n| n.is_finite())
        {
            return Err(CoreError::InvalidState);
        }
        let norm = normal.iter().fold(0.0f64, |a, b| a.hypot(*b));
        if !norm.is_finite() || norm <= 1e-12 {
            return Err(CoreError::InvalidState);
        }
        Ok(Self {
            position_m,
            normal: normal.map(|n| n / norm),
        })
    }
    pub fn position_m(&self) -> [f64; 3] {
        self.position_m
    }
    pub fn normal(&self) -> [f64; 3] {
        self.normal
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TriangleMesh {
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
}
impl TriangleMesh {
    pub fn new(vertices: Vec<Vertex>, indices: Vec<u32>) -> Result<Self, CoreError> {
        if !(3..=MAX_VERTICES).contains(&vertices.len())
            || indices.is_empty()
            || indices.len() > MAX_INDICES
            || !indices.len().is_multiple_of(3)
            || indices.iter().any(|i| *i as usize >= vertices.len())
        {
            return Err(CoreError::InvalidState);
        }
        for triangle in indices.as_chunks::<3>().0 {
            let [a, b, c] = triangle.map(|i| vertices[i as usize].position_m);
            let u: [f64; 3] = std::array::from_fn(|i| b[i] - a[i]);
            let v: [f64; 3] = std::array::from_fn(|i| c[i] - a[i]);
            let cross = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            let area = cross.into_iter().fold(0.0f64, |a, b| a.hypot(b));
            let length = |p: [f64; 3]| p.into_iter().fold(0.0f64, |a, b| a.hypot(b));
            if area <= 32.0 * f64::EPSILON * length(u) * length(v) {
                return Err(CoreError::InvalidState);
            }
        }
        Ok(Self { vertices, indices })
    }
    pub fn vertices(&self) -> &[Vertex] {
        &self.vertices
    }
    pub fn indices(&self) -> &[u32] {
        &self.indices
    }
    pub fn byte_len(&self) -> u64 {
        (self.vertices.len() as u64) * 48 + (self.indices.len() as u64) * 4
    }
}
