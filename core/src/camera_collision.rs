//! Camera-only scientific sphere sweeps. Texture LOD is not terrain traversal.
use bevy::math::DVec3;

#[derive(Clone, Copy)]
pub(crate) struct SolidSphere {
    pub center: DVec3,
    pub radius: f64,
}
fn padded(s: &SolidSphere) -> f64 {
    s.radius * 1.0001
}

/// Resolve an existing overlap, then sweep the entire motion segment so a large
/// wheel delta or a focus transition cannot tunnel through a body.
pub(crate) fn constrain(mut start: DVec3, mut end: DVec3, spheres: &[SolidSphere]) -> DVec3 {
    if !end.is_finite() {
        return start;
    }
    for s in spheres {
        let r = padded(s);
        if !r.is_finite() || r <= 0. {
            continue;
        }
        let from = start - s.center;
        if from.length() < r {
            let normal = from
                .try_normalize()
                .or_else(|| (end - s.center).try_normalize())
                .unwrap_or(DVec3::Z);
            start = s.center + normal * r;
        }
        let to = end - s.center;
        if to.length() < r {
            let normal = to
                .try_normalize()
                .or_else(|| (start - s.center).try_normalize())
                .unwrap_or(DVec3::Z);
            end = s.center + normal * r;
        }
    }
    // Stop at first contact, then take a bounded tangent step around the solid.
    // This also lets a focus transition detour instead of getting stuck on an
    // exactly head-on path. Each tangent segment is swept against all bodies.
    for _ in 0..8 {
        let delta = end - start;
        let length = delta.length();
        if length <= f64::EPSILON {
            return start;
        }
        let direction = delta / length;
        let mut first: Option<(f64, &SolidSphere)> = None;
        for s in spheres {
            let r = padded(s);
            if !r.is_finite() || r <= 0. {
                continue;
            }
            let offset = start - s.center;
            let along = offset.dot(direction);
            if along >= 0. {
                continue;
            }
            let lateral = offset - direction * along;
            let disc = r * r - lateral.length_squared();
            if disc <= 0. {
                continue;
            }
            let hit = -along - disc.sqrt();
            if hit >= -r * 1e-9 && hit < length && first.is_none_or(|(t, _)| hit < t) {
                first = Some((hit.max(0.), s));
            }
        }
        let Some((hit, s)) = first else {
            return end;
        };
        let r = padded(s);
        let contact = start + direction * (hit - r * 1e-7).max(0.);
        let normal = (contact - s.center).normalize_or_zero();
        let remaining = end - contact;
        let tangent = remaining - normal * remaining.dot(normal);
        let tangent = tangent
            .try_normalize()
            .unwrap_or_else(|| normal.any_orthonormal_vector());
        start = contact + normal * (r * 1e-7);
        end = start + tangent * remaining.length().min(r * 0.25);
    }
    start
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sweep_blocks_tunneling_and_allows_tangent_motion() {
        let body = SolidSphere {
            center: DVec3::ZERO,
            radius: 2.,
        };
        let start = DVec3::new(0., 0., 10.);
        let end = DVec3::new(0., 0., -10.);
        let result = constrain(start, end, &[body]);
        assert!(result.length() > 2.);
        assert!(result.z > 0.);
        let closest = start
            + (result - start)
                * (-start.dot(result - start) / (result - start).length_squared()).clamp(0., 1.);
        assert!(closest.length() >= 2.);
        let miss = DVec3::new(4., 0., -10.);
        assert_eq!(constrain(DVec3::new(4., 0., 10.), miss, &[body]), miss);
    }
    #[test]
    fn recovers_inside_and_detours_repeated_head_on_focus() {
        let body = SolidSphere {
            center: DVec3::ZERO,
            radius: 2.,
        };
        assert!(constrain(DVec3::ZERO, DVec3::ZERO, &[body]).length() >= 2.);
        let target = DVec3::new(0., 0., -10.);
        let mut camera = DVec3::new(0., 0., 10.);
        for _ in 0..100 {
            camera = constrain(camera, target, &[body]);
            assert!(camera.length() > 2.);
        }
        assert!(camera.distance(target) < 1e-6);
    }
    #[test]
    fn nearest_body_and_rebased_coordinates_are_consistent() {
        let bodies = [
            SolidSphere {
                center: DVec3::ZERO,
                radius: 2.,
            },
            SolidSphere {
                center: DVec3::new(0., 0., 5.),
                radius: 1.,
            },
        ];
        let start = DVec3::new(0., 0., 10.);
        let end = DVec3::new(0., 0., -10.);
        let a = constrain(start, end, &bodies);
        assert!(a.z > 5.);
        let shift = DVec3::new(1e8, -2e8, 3e8);
        let shifted = bodies.map(|s| SolidSphere {
            center: s.center + shift,
            ..s
        });
        let b = constrain(start + shift, end + shift, &shifted) - shift;
        assert!(a.distance(b) < 1e-5);
    }
}
