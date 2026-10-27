// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_geometry::{ColorSpace, TextureData, Vertex};
#[test]
fn texture_data_rejects_dimensions_byte_counts_and_unsupported_alpha() {
    assert!(TextureData::new(0, 1, vec![], ColorSpace::Linear).is_err());
    assert!(TextureData::new(2049, 1, vec![], ColorSpace::Linear).is_err());
    assert!(TextureData::new(2, 1, vec![255; 4], ColorSpace::Linear).is_err());
    assert!(TextureData::new(1, 1, vec![1, 2, 3, 0], ColorSpace::Linear).is_err());
    let texture = TextureData::new(1, 1, vec![1, 2, 3, 255], ColorSpace::Srgb).unwrap();
    assert_eq!(texture.byte_len(), 4);
    assert_eq!(texture.color_space(), ColorSpace::Srgb);
}
#[test]
fn uv_is_explicit_finite_and_backwards_compatible() {
    let old = Vertex::new([0.0; 3], [0.0, 0.0, 1.0]).unwrap();
    assert_eq!(old.uv(), [0.0; 2]);
    assert!(Vertex::with_uv([0.0; 3], [0.0, 0.0, 1.0], [f32::NAN, 0.0]).is_err());
    assert_eq!(
        Vertex::with_uv([0.0; 3], [0.0, 0.0, 1.0], [-0.5, 2.0])
            .unwrap()
            .uv(),
        [-0.5, 2.0]
    );
}
