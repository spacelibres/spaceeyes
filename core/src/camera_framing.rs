//! NASA Eyes Cameras.getDistanceToFitEntities, converted from +Y forward to
//! Bevy's camera-at-positive-Z basis. All quantities stay in physical kilometres.
use crate::VisualSpec;
use bevy::math::{DQuat, DVec3};

#[derive(Clone, Copy, Debug)]
pub(crate) struct FramingBody {
    pub offset_km: DVec3,
    pub radius_km: f64,
}

pub(crate) fn fit_distance(
    bodies: &[FramingBody],
    camera_rotation: DQuat,
    horizontal_half: f64,
    vertical_half: f64,
) -> Option<f64> {
    if bodies.is_empty()
        || !camera_rotation.is_finite()
        || (camera_rotation.length_squared() - 1.).abs() > 1e-6
        || [horizontal_half, vertical_half]
            .iter()
            .any(|a| !a.is_finite() || *a <= 0. || *a >= std::f64::consts::FRAC_PI_2)
    {
        return None;
    }
    let inverse = camera_rotation.inverse();
    let mut distance = 0_f64;
    for body in bodies {
        if !body.offset_km.is_finite() || !body.radius_km.is_finite() || body.radius_km < 0. {
            return None;
        }
        let local = inverse * body.offset_km;
        distance = distance.max(
            local.x.abs() / horizontal_half.tan()
                + body.radius_km / horizontal_half.sin()
                + local.z,
        );
        distance = distance.max(
            local.y.abs() / vertical_half.tan() + body.radius_km / vertical_half.sin() + local.z,
        );
    }
    distance.is_finite().then_some(distance)
}

pub(crate) fn visual_extent_km(physical: f64, spec: Option<&VisualSpec>) -> f64 {
    let candidate = match spec {
        Some(VisualSpec::Sphere {
            ring_outer_radius_ratio: Some(ratio),
            ..
        }) => physical * ratio,
        Some(VisualSpec::Model {
            framing_radius_km: Some(hint),
            ..
        }) => *hint,
        _ => physical,
    };
    if candidate.is_finite() {
        candidate.max(physical)
    } else {
        physical
    }
}

/// NASA CameraScripts' minimum planet-system viewing distances, in km.
pub(crate) fn system_min_distance_km(id: &str) -> Option<f64> {
    Some(match id {
        "mercury" => 425648.,
        "venus" => 862136.,
        "earth" => 1040264.,
        "mars" => 80000.,
        "jupiter" => 7157638.,
        "saturn" => 4869142.,
        "uranus" => 1886367.,
        "neptune" => 2407045.,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fit(offset: DVec3, radius: f64, rotation: DQuat, h: f64, v: f64) -> f64 {
        fit_distance(
            &[FramingBody {
                offset_km: offset,
                radius_km: radius,
            }],
            rotation,
            h,
            v,
        )
        .unwrap()
    }
    #[test]
    fn central_sphere_uses_narrow_axis_tangent_envelope() {
        assert!(
            (fit(DVec3::ZERO, 7., DQuat::IDENTITY, 0.6, 0.3) - 7. / 0.3_f64.sin()).abs() < 1e-12
        );
    }
    #[test]
    fn wide_and_portrait_preserve_asymmetric_positions() {
        let p = DVec3::new(10., 2., 3.);
        let wide = fit(p, 1., DQuat::IDENTITY, 0.6, 0.3);
        let portrait = fit(p, 1., DQuat::IDENTITY, 0.3, 0.6);
        assert!((wide - (10. / 0.6_f64.tan() + 1. / 0.6_f64.sin() + 3.)).abs() < 1e-12);
        assert!(portrait > wide);
        assert!((fit(p + DVec3::Z * 5., 1., DQuat::IDENTITY, 0.6, 0.3) - wide - 5.).abs() < 1e-12);
    }
    #[test]
    fn rotated_camera_uses_inverse_view_basis() {
        let rotation = DQuat::from_rotation_y(0.7);
        let local = DVec3::new(12., 4., -2.);
        assert!(
            (fit(rotation * local, 2., rotation, 0.5, 0.3)
                - fit(local, 2., DQuat::IDENTITY, 0.5, 0.3))
            .abs()
                < 1e-12
        );
    }
    #[test]
    fn rejects_invalid_fit_inputs() {
        assert!(fit_distance(&[], DQuat::IDENTITY, 0.5, 0.5).is_none());
        let body = [FramingBody {
            offset_km: DVec3::ZERO,
            radius_km: -1.,
        }];
        assert!(fit_distance(&body, DQuat::IDENTITY, 0.5, 0.5).is_none());
        let body = [FramingBody {
            offset_km: DVec3::ZERO,
            radius_km: 1.,
        }];
        assert!(fit_distance(&body, DQuat::IDENTITY, f64::NAN, 0.5).is_none());
    }
    #[test]
    fn model_extent_hint_cannot_shrink_physical_sphere() {
        let mut model = VisualSpec::Model {
            asset_id: "model".into(),
            scene: 0,
            scale_km_per_unit: 1.,
            framing_radius_km: Some(5.),
        };
        assert_eq!(visual_extent_km(2., Some(&model)), 5.);
        if let VisualSpec::Model {
            framing_radius_km, ..
        } = &mut model
        {
            *framing_radius_km = Some(1.);
        }
        assert_eq!(visual_extent_km(2., Some(&model)), 2.);
        assert_eq!(visual_extent_km(2., None), 2.);
    }
    #[test]
    fn ring_envelope_includes_outer_radius() {
        let rings: VisualSpec =
            serde_json::from_str(r#"{"kind":"sphere","ringOuterRadiusRatio":2.4}"#).unwrap();
        assert_eq!(visual_extent_km(10., Some(&rings)), 24.);
        let body = FramingBody {
            offset_km: DVec3::ZERO,
            radius_km: visual_extent_km(10., Some(&rings)),
        };
        assert!(
            (fit_distance(&[body], DQuat::IDENTITY, 0.5, 0.5).unwrap() - 24. / 0.5_f64.sin()).abs()
                < 1e-12
        );
    }
    #[test]
    fn nasa_system_minimums_are_exact() {
        for (id, value) in [
            ("mercury", 425648.),
            ("venus", 862136.),
            ("earth", 1040264.),
            ("mars", 80000.),
            ("jupiter", 7157638.),
            ("saturn", 4869142.),
            ("uranus", 1886367.),
            ("neptune", 2407045.),
        ] {
            assert_eq!(system_min_distance_km(id), Some(value));
        }
        assert_eq!(system_min_distance_km("moon"), None);
    }
}
