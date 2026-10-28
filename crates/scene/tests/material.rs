// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
use spaceeyes_scene::Material;

#[test]
fn material_alpha_is_bounded_and_defaults_to_opaque() {
    let material = Material::new([0.2, 0.4, 0.6], None, Default::default(), false).unwrap();
    assert_eq!(material.alpha(), 1.0);
    let blended = material.clone().with_alpha(0.5).unwrap();
    assert_eq!(blended.alpha(), 0.5);
    assert_eq!(blended.base_color(), [0.2, 0.4, 0.6]);
    for alpha in [-0.1, 1.1, f32::NAN, f32::INFINITY] {
        assert!(material.clone().with_alpha(alpha).is_err(), "{alpha}");
    }
}
