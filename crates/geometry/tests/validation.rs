// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_geometry::{TriangleMesh, Vertex};
fn vertices() -> Vec<Vertex> {
    vec![
        Vertex::new([-1.0, -1.0, 0.0], [0.0, 0.0, 2.0]).unwrap(),
        Vertex::new([1.0, -1.0, 0.0], [0.0, 0.0, 1.0]).unwrap(),
        Vertex::new([0.0, 1.0, 0.0], [0.0, 0.0, 1.0]).unwrap(),
    ]
}
#[test]
fn mesh_rejects_invalid_indices_degenerate_triangles_and_nonfinite_data() {
    for indices in [vec![], vec![0, 1], vec![0, 1, 3], vec![0, 0, 1]] {
        assert!(TriangleMesh::new(vertices(), indices).is_err());
    }
    assert!(Vertex::new([f64::NAN, 0.0, 0.0], [0.0, 0.0, 1.0]).is_err());
    assert!(Vertex::new([1e13, 0.0, 0.0], [0.0, 0.0, 1.0]).is_err());
    assert!(Vertex::new([0.0; 3], [0.0; 3]).is_err());
    let line = vec![
        Vertex::new([0.0; 3], [0.0, 1.0, 0.0]).unwrap(),
        Vertex::new([1.0, 0.0, 0.0], [0.0, 1.0, 0.0]).unwrap(),
        Vertex::new([2.0, 0.0, 0.0], [0.0, 1.0, 0.0]).unwrap(),
    ];
    assert!(TriangleMesh::new(line, vec![0, 1, 2]).is_err());
}
#[test]
fn mesh_retains_indices_normalizes_normals_and_reports_its_allocation() {
    let mesh = TriangleMesh::new(vertices(), vec![0, 1, 2]).unwrap();
    assert_eq!(mesh.vertices()[0].normal(), [0.0, 0.0, 1.0]);
    assert_eq!(mesh.indices(), &[0, 1, 2]);
    assert_eq!(mesh.byte_len(), 156);
}
