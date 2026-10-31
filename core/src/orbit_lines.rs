//! Temporal polyline attachment uses core state, never a nearest spatial guess.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn parent_path_visibility(
    near_visibility: f32,
    style: Option<&crate::TrajectoryStyle>,
    focused: Option<&str>,
) -> f32 {
    if focused.is_some_and(|focus| style.is_some_and(|s| s.origin_id.as_deref() == Some(focus))) {
        1.
    } else {
        near_visibility
    }
}
/// Camera target and its explicit trajectory reference parent are different roles.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) struct TrajectoryFocus<'a> {
    pub focused: Option<&'a str>,
    pub parent: Option<&'a str>,
}
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn system_path_visibility(
    id: &str,
    points: &[[f64; 3]],
    focus_range: Option<f64>,
    near_visibility: f32,
    style: Option<&crate::TrajectoryStyle>,
    view: &TrajectoryFocus<'_>,
) -> f32 {
    // Protect the focused satellite's host and its peers, not its own close-up path.
    if view.focused.is_some_and(|focused| id != focused)
        // The NASA scene root is not a local planetary satellite system.
        && view.parent.filter(|parent| *parent != "sun").is_some_and(|parent| {
            id == parent || style.is_some_and(|s| s.origin_id.as_deref() == Some(parent))
        })
    {
        return 1.;
    }
    path_visibility(points, focus_range, near_visibility, style, view.focused)
}
/// Both fade stages must share the same parent policy. A child orbit is not
/// the focused host's orbit, regardless of whether it is a natural orbit or history.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn path_visibility(
    points: &[[f64; 3]],
    focus_range: Option<f64>,
    near_visibility: f32,
    style: Option<&crate::TrajectoryStyle>,
    focused: Option<&str>,
) -> f32 {
    if focused.is_some_and(|focus| style.is_some_and(|s| s.origin_id.as_deref() == Some(focus))) {
        return 1.;
    }
    parent_path_visibility(near_visibility, style, focused)
        * path_scale_fade(points, focus_range, style.and_then(|s| s.kind.as_deref()))
}
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn path_scale_fade(
    points: &[[f64; 3]],
    focus_range: Option<f64>,
    kind: Option<&str>,
) -> f32 {
    let Some(range) = focus_range.filter(|r| r.is_finite() && *r >= 0.) else {
        return 1.;
    };
    if kind == Some("trail") || points.len() < 2 {
        return 1.;
    }
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in points {
        for i in 0..3 {
            if !p[i].is_finite() {
                return 1.;
            }
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    let radius = ((hi[0] - lo[0]).hypot(hi[1] - lo[1])).hypot(hi[2] - lo[2]) * 0.5;
    if !radius.is_finite() || radius <= 0. {
        return 1.;
    }
    let t = ((range / radius - 0.02) / 0.06).clamp(0., 1.);
    (t * t * (3. - 2. * t)) as f32
}
#[cfg(test)]
mod scale_tests {
    use super::*;
    #[test]
    fn local_system_hides_solar_orbit_but_keeps_trail_and_recovers() {
        let p = [[-7e8, 0., 0.], [7e8, 0., 0.]];
        assert_eq!(path_scale_fade(&p, Some(7e6), None), 0.);
        assert_eq!(path_scale_fade(&p, Some(7e6), Some("trail")), 1.);
        assert_eq!(path_scale_fade(&p, None, None), 1.);
        assert_eq!(path_scale_fade(&p, Some(7e8 * 0.08), None), 1.);
        assert!((path_scale_fade(&p, Some(7e8 * 0.05), None) - 0.5).abs() < 1e-6);
        assert_eq!(path_scale_fade(&[[0.; 3]; 2], Some(1.), None), 1.);
    }
}
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn distance_fade(distance_radii: f32) -> f32 {
    let t = ((distance_radii - 16.) / 112.).clamp(0., 1.);
    t * t * (3. - 2. * t)
}
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn visit_segments(
    points: &[[f64; 3]],
    epochs: Option<&[f64]>,
    epoch: f64,
    current: [f64; 3],
    mut draw: impl FnMut([f64; 3], [f64; 3]),
) {
    for (i, pair) in points.windows(2).enumerate() {
        if let Some(times) = epochs.filter(|times| times.len() == points.len()) {
            if epoch == times[i] {
                draw(current, pair[1]);
                continue;
            }
            if epoch == times[i + 1] {
                draw(pair[0], current);
                continue;
            }
            if times[i] < epoch && epoch < times[i + 1] {
                draw(pair[0], current);
                draw(current, pair[1]);
                continue;
            }
        }
        draw(pair[0], pair[1]);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn close_inspection_hides_orbits_and_zooming_out_restores_them_continuously() {
        assert_eq!(distance_fade(4.), 0.);
        assert!((distance_fade(72.) - 0.5).abs() < 1e-6);
        assert_eq!(distance_fade(128.), 1.);
        assert!((16..128).all(|d| distance_fade(d as f32) <= distance_fade(d as f32 + 1.)));
    }
    #[test]
    fn current_epoch_splits_its_own_interval_in_both_playback_directions() {
        for epoch in [7., 3.] {
            let p = [epoch, 2., 0.];
            let mut lines = vec![];
            visit_segments(
                &[[0., 0., 0.], [10., 0., 0.]],
                Some(&[0., 10.]),
                epoch,
                p,
                |a, b| lines.push((a, b)),
            );
            assert_eq!(lines, vec![([0., 0., 0.], p), (p, [10., 0., 0.])]);
        }
    }
    #[test]
    fn exact_vertex_is_updated_without_closing_uncovered_endpoints() {
        let points = [[0., 0., 0.], [5., 0., 0.], [10., 0., 0.]];
        let p = [5., 2., 0.];
        let mut lines = vec![];
        visit_segments(&points, Some(&[0., 5., 10.]), 5., p, |a, b| {
            lines.push((a, b))
        });
        assert_eq!(lines, vec![(points[0], p), (p, points[2])]);
        lines.clear();
        visit_segments(&points, None, 5., p, |a, b| lines.push((a, b)));
        assert_eq!(lines, vec![(points[0], points[1]), (points[1], points[2])]);
    }
}

/// Clip cached scientific samples to the past, preserving explicit discontinuities.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn visit_styled_segments(
    points: &[[f64; 3]],
    epochs: Option<&[f64]>,
    epoch: f64,
    current: [f64; 3],
    style: Option<&crate::TrajectoryStyle>,
    mut draw: impl FnMut([f64; 3], [f64; 3], f32, f32),
) {
    if let Some(conic) = style
        .filter(|s| s.kind.as_deref() == Some("orbit"))
        .and_then(|s| s.conic.as_ref())
    {
        static CIRCLE: std::sync::LazyLock<[(f64, f64); 360]> = std::sync::LazyLock::new(|| {
            std::array::from_fn(|i| (i as f64 * std::f64::consts::PI / 180.).sin_cos())
        });
        let dot = |v: [f64; 3]| current.into_iter().zip(v).map(|(a, b)| a * b).sum::<f64>();
        let angle = dot(conic.transverse_unit)
            .atan2(dot(conic.radial_unit))
            .rem_euclid(std::f64::consts::TAU);
        let sample = |(sin, cos): (f64, f64)| {
            let r = conic.semi_latus_rectum_km
                / (1. + conic.eccentricity_radial * cos + conic.eccentricity_transverse * sin);
            std::array::from_fn(|i| {
                r * (conic.radial_unit[i] * cos + conic.transverse_unit[i] * sin)
            })
        };
        let expected = sample(angle.sin_cos());
        let error = (0..3)
            .map(|i| (current[i] - expected[i]).powi(2))
            .sum::<f64>()
            .sqrt();
        let radius = expected.into_iter().map(|x| x * x).sum::<f64>().sqrt();
        let replace = error.is_finite() && error <= radius * 1e-5;
        let slot = (angle.to_degrees().round() as usize) % 360;
        let vertex = |i: usize| {
            if replace && i % 360 == slot {
                current
            } else {
                sample(CIRCLE[i % 360])
            }
        };
        let first = vertex(0);
        let mut previous = first;
        for i in 1..360 {
            let next = vertex(i);
            draw(previous, next, 1., 1.);
            previous = next;
        }
        draw(previous, first, 1., 1.);
        return;
    }
    let breaks = style.map(|s| s.break_indices.as_slice()).unwrap_or(&[]);
    if let Some(duration) = style
        .filter(|s| s.kind.as_deref() == Some("trail"))
        .and_then(|s| s.trail_duration_seconds)
    {
        let Some(times) = epochs.filter(|t| t.len() == points.len()) else {
            return;
        };
        if times.len() < 2 {
            return;
        }
        let index_at = |t: f64| {
            let right = times.partition_point(|value| *value < t);
            if right == 0 {
                0.
            } else if right >= times.len() {
                (times.len() - 1) as f64
            } else {
                (right - 1) as f64 + (t - times[right - 1]) / (times[right] - times[right - 1])
            }
        };
        let first = index_at(epoch - duration);
        let span = (index_at(epoch) - first).max(f64::EPSILON);
        for (i, pair) in points.windows(2).enumerate() {
            if breaks.binary_search(&(i + 1)).is_ok() {
                continue;
            }
            let lo = times[i].max(epoch - duration);
            let hi = times[i + 1].min(epoch);
            if lo >= hi {
                continue;
            }
            let sample = |t: f64| {
                if t == epoch {
                    current
                } else {
                    let u = (t - times[i]) / (times[i + 1] - times[i]);
                    std::array::from_fn(|j| pair[0][j] + u * (pair[1][j] - pair[0][j]))
                }
            };
            draw(
                sample(lo),
                sample(hi),
                ((index_at(lo) - first) / span).clamp(0., 1.) as f32,
                ((index_at(hi) - first) / span).clamp(0., 1.) as f32,
            );
        }
    } else {
        for (i, pair) in points.windows(2).enumerate() {
            if breaks.binary_search(&(i + 1)).is_ok() {
                continue;
            }
            let times = epochs.map(|t| &t[i..=i + 1]);
            visit_segments(pair, times, epoch, current, |a, b| draw(a, b, 1., 1.));
        }
    }
}

#[cfg(test)]
mod trail_tests {
    use super::*;
    #[test]
    fn base_policy_only_protects_direct_children() {
        let style = crate::TrajectoryStyle {
            kind: Some("trail".into()),
            origin_id: Some("earth".into()),
            ..Default::default()
        };
        assert_eq!(parent_path_visibility(0., Some(&style), Some("earth")), 1.);
        assert_eq!(parent_path_visibility(0., Some(&style), Some("iss")), 0.);
        assert_eq!(parent_path_visibility(0., None, Some("earth")), 0.);
        assert_eq!(parent_path_visibility(0.6, Some(&style), None), 0.6);
    }
    #[test]
    fn selected_satellite_does_not_hide_other_satellites_of_its_host() {
        let lunar = [[-384_400., 0., 0.], [384_400., 0., 0.]];
        let sibling = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            origin_id: Some("earth".into()),
            ..Default::default()
        };
        assert_eq!(
            system_path_visibility(
                "moon",
                &lunar,
                Some(0.01),
                0.,
                Some(&sibling),
                &TrajectoryFocus {
                    focused: Some("sc_iss"),
                    parent: Some("earth")
                }
            ),
            1.
        );
    }
    #[test]
    fn satellite_family_keeps_host_peers_and_children_but_fades_own_and_foreign_paths() {
        let points = [[-1e6, 0., 0.], [1e6, 0., 0.]];
        for (selected, parent) in [
            ("sc_iss", "earth"),
            ("moon", "earth"),
            ("io", "jupiter"),
            ("titan", "saturn"),
        ] {
            let view = TrajectoryFocus {
                focused: Some(selected),
                parent: Some(parent),
            };
            let own = crate::TrajectoryStyle {
                kind: Some("orbit".into()),
                origin_id: Some(parent.into()),
                ..Default::default()
            };
            let host = crate::TrajectoryStyle {
                kind: Some("orbit".into()),
                origin_id: Some("sun".into()),
                ..Default::default()
            };
            assert_eq!(
                system_path_visibility(parent, &points, Some(0.001), 0., Some(&host), &view),
                1.
            );
            assert_eq!(
                system_path_visibility(selected, &points, Some(0.001), 0., Some(&own), &view),
                0.
            );
            for kind in ["orbit", "trail"] {
                let peer = crate::TrajectoryStyle {
                    kind: Some(kind.into()),
                    origin_id: Some(parent.into()),
                    ..Default::default()
                };
                let child = crate::TrajectoryStyle {
                    kind: Some(kind.into()),
                    origin_id: Some(selected.into()),
                    ..Default::default()
                };
                assert_eq!(
                    system_path_visibility("peer", &points, Some(0.001), 0., Some(&peer), &view),
                    1.
                );
                assert_eq!(
                    system_path_visibility("child", &points, Some(0.001), 0., Some(&child), &view),
                    1.
                );
                assert_eq!(
                    system_path_visibility(selected, &points, Some(0.001), 0., Some(&peer), &view),
                    0.
                );
            }
            let unrelated = crate::TrajectoryStyle {
                kind: Some("orbit".into()),
                origin_id: Some("other-system".into()),
                ..Default::default()
            };
            assert_eq!(
                system_path_visibility("other", &points, Some(0.001), 0., Some(&unrelated), &view),
                0.
            );
            let no_parent = TrajectoryFocus {
                focused: Some(selected),
                parent: None,
            };
            assert_eq!(
                system_path_visibility("peer", &points, Some(0.001), 0., Some(&own), &no_parent),
                0.
            );
        }
        let earth_peer = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            origin_id: Some("earth".into()),
            ..Default::default()
        };
        assert_eq!(
            system_path_visibility(
                "moon",
                &points,
                Some(0.001),
                0.,
                Some(&earth_peer),
                &TrajectoryFocus {
                    focused: Some("io"),
                    parent: Some("jupiter")
                }
            ),
            0.
        );
        assert_eq!(
            system_path_visibility(
                "moon",
                &points,
                None,
                1.,
                Some(&earth_peer),
                &TrajectoryFocus {
                    focused: None,
                    parent: None
                }
            ),
            1.
        );
    }
    #[test]
    fn solar_root_reference_does_not_turn_planet_focus_into_a_local_satellite_family() {
        let points = [[-1e8, 0., 0.], [1e8, 0., 0.]];
        let peer = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            origin_id: Some("sun".into()),
            ..Default::default()
        };
        let view = TrajectoryFocus {
            focused: Some("earth"),
            parent: Some("sun"),
        };
        assert_eq!(
            system_path_visibility("jupiter", &points, Some(0.01), 0., Some(&peer), &view),
            0.
        );
    }
    #[test]
    fn parent_inspection_keeps_natural_satellite_orbits_at_every_zoom() {
        for parent in ["earth", "jupiter", "saturn", "uranus", "neptune"] {
            let style = crate::TrajectoryStyle {
                kind: Some("orbit".into()),
                origin_id: Some(parent.into()),
                ..Default::default()
            };
            for visibility in [0., 0.25, 0.6, 1.] {
                assert_eq!(
                    parent_path_visibility(visibility, Some(&style), Some(parent)),
                    1.
                );
            }
        }
    }
    #[test]
    fn host_fades_but_child_orbits_and_trails_bypass_both_fades_without_stale_parent() {
        let solar = [[-149_597_870.7, 0., 0.], [149_597_870.7, 0., 0.]];
        let lunar = [[-384_400., 0., 0.], [384_400., 0., 0.]];
        let mut host = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            origin_id: Some("sun".into()),
            ..Default::default()
        };
        let mut child = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            origin_id: Some("earth".into()),
            ..Default::default()
        };
        assert_eq!(path_scale_fade(&lunar, Some(1_000.), Some("orbit")), 0.);
        assert_eq!(
            path_visibility(&solar, Some(1_000.), 0., Some(&host), Some("earth")),
            0.
        );
        assert_eq!(
            path_visibility(&solar, Some(3e8), 1., Some(&host), Some("earth")),
            1.
        );
        for range in [1_000., 7_000., 1e6, 3e8] {
            for near in [0., 0.25, 0.75, 1.] {
                assert_eq!(
                    path_visibility(&lunar, Some(range), near, Some(&child), Some("earth")),
                    1.
                );
                child.kind = Some("trail".into());
                assert_eq!(
                    path_visibility(&lunar, Some(range), near, Some(&child), Some("earth")),
                    1.
                );
                child.kind = Some("orbit".into());
            }
        }
        assert_eq!(
            path_visibility(&lunar, Some(1_000.), 0., Some(&child), Some("jupiter")),
            0.
        );
        child.origin_id = Some("jupiter".into());
        assert_eq!(
            path_visibility(&lunar, Some(1_000.), 0., Some(&child), Some("jupiter")),
            1.
        );
        host.origin_id = Some("earth".into());
        assert_eq!(path_visibility(&lunar, None, 1., Some(&host), None), 1.);
        assert_eq!(
            path_visibility(&lunar, Some(1_000.), 0., None, Some("earth")),
            0.
        );
    }
    #[test]
    fn clips_past_window_and_never_bridges_breaks_or_uncovered_future() {
        let points = [[0., 0., 0.], [10., 0., 0.], [20., 0., 0.]];
        let mut style = crate::TrajectoryStyle {
            kind: Some("trail".into()),
            trail_duration_seconds: Some(6.),
            ..Default::default()
        };
        let mut lines = vec![];
        visit_styled_segments(
            &points,
            Some(&[0., 10., 20.]),
            15.,
            [15., 2., 0.],
            Some(&style),
            |a, b, x, y| lines.push((a, b, x, y)),
        );
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].0, [9., 0., 0.]);
        assert_eq!(lines[1].1, [15., 2., 0.]);
        assert_eq!(lines[0].2, 0.);
        assert_eq!(lines[1].3, 1.);
        style.break_indices = vec![2];
        lines.clear();
        visit_styled_segments(
            &points,
            Some(&[0., 10., 20.]),
            15.,
            [15., 2., 0.],
            Some(&style),
            |a, b, x, y| lines.push((a, b, x, y)),
        );
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].1, points[1]);
        lines.clear();
        visit_styled_segments(
            &points,
            Some(&[0., 10., 20.]),
            30.,
            [30., 2., 0.],
            Some(&style),
            |a, b, x, y| lines.push((a, b, x, y)),
        );
        assert!(lines.is_empty());
    }
}

#[cfg(test)]
mod conic_tests {
    use super::*;
    #[test]
    fn closed_degree_ring_attaches_exact_current_without_epoch_dependence() {
        let c = crate::ConicOrbit {
            semi_latus_rectum_km: 100.,
            radial_unit: [1., 0., 0.],
            transverse_unit: [0., 1., 0.],
            eccentricity_radial: 0.2,
            eccentricity_transverse: 0.1,
        };
        let theta = 0.123_f64;
        let r = 100. / (1. + 0.2 * theta.cos() + 0.1 * theta.sin());
        let current = [r * theta.cos(), r * theta.sin(), 0.];
        let style = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            conic: Some(c),
            ..Default::default()
        };
        for epoch in [0., 1e15, -1e15] {
            let mut lines = vec![];
            visit_styled_segments(&[], None, epoch, current, Some(&style), |a, b, _, _| {
                lines.push((a, b))
            });
            assert_eq!(lines.len(), 360);
            assert_eq!(lines[359].1, lines[0].0);
            assert!(lines.iter().any(|(a, _)| *a == current));
            for (a, b) in lines {
                for p in [a, b] {
                    let radius = p[0].hypot(p[1]);
                    assert!((radius + 0.2 * p[0] + 0.1 * p[1] - 100.).abs() < 1e-10);
                }
                let angle = (a[0] * b[1] - a[1] * b[0]).atan2(a[0] * b[0] + a[1] * b[1]);
                assert!(angle > 0. && angle < 2_f64.to_radians());
            }
        }
    }
    #[test]
    fn off_plane_current_does_not_deform_ring() {
        let style = crate::TrajectoryStyle {
            kind: Some("orbit".into()),
            conic: Some(crate::ConicOrbit {
                semi_latus_rectum_km: 100.,
                radial_unit: [1., 0., 0.],
                transverse_unit: [0., 1., 0.],
                eccentricity_radial: 0.,
                eccentricity_transverse: 0.,
            }),
            ..Default::default()
        };
        let mut count = 0;
        visit_styled_segments(
            &[],
            None,
            0.,
            [100., 0., 0.002],
            Some(&style),
            |a, b, _, _| {
                count += 1;
                assert_eq!(a[2], 0.);
                assert_eq!(b[2], 0.);
                assert!((a[0].hypot(a[1]) - 100.).abs() < 1e-10);
            },
        );
        assert_eq!(count, 360);
    }
    #[test]
    fn rejects_invalid_basis_and_wire_fields() {
        let wire = r#"{"semiLatusRectumKm":100,"radialUnit":[1,0,0],"transverseUnit":[0,1,0],"eccentricityRadial":0,"eccentricityTransverse":0}"#;
        let mut c: crate::ConicOrbit = serde_json::from_str(wire).unwrap();
        assert!(c.is_valid());
        c.transverse_unit = [1., 0., 0.];
        assert!(!c.is_valid());
        c.transverse_unit = [0., 2., 0.];
        assert!(!c.is_valid());
        assert!(
            serde_json::from_str::<crate::ConicOrbit>(&wire.replace("100,", "100,\"extra\":0,"))
                .is_err()
        );
    }
}

#[cfg(test)]
mod nasa_index_fade_tests {
    use super::*;
    #[test]
    fn adaptive_times_fade_by_visible_sample_index_like_nasa() {
        let style = crate::TrajectoryStyle {
            kind: Some("trail".into()),
            trail_duration_seconds: Some(10.),
            ..Default::default()
        };
        let mut alpha = vec![];
        visit_styled_segments(
            &[[0., 0., 0.], [1., 0., 0.], [9., 0., 0.], [10., 0., 0.]],
            Some(&[0., 1., 9., 10.]),
            10.,
            [10., 0., 0.],
            Some(&style),
            |_, _, a, b| alpha.push((a, b)),
        );
        assert!((alpha[0].1 - 1. / 3.).abs() < 1e-6);
        assert!((alpha[1].1 - 2. / 3.).abs() < 1e-6);
        assert_eq!(alpha[2].1, 1.);
    }
}
