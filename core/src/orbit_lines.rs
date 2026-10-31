//! Temporal polyline attachment uses core state, never a nearest spatial guess.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) fn parent_trail_visibility(
    near_visibility: f32,
    style: Option<&crate::TrajectoryStyle>,
    focused: Option<&str>,
) -> f32 {
    if focused.is_some_and(|focus| {
        style.is_some_and(|s| {
            s.kind.as_deref() == Some("trail") && s.origin_id.as_deref() == Some(focus)
        })
    }) {
        1.
    } else {
        near_visibility
    }
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
    let breaks = style.map(|s| s.break_indices.as_slice()).unwrap_or(&[]);
    if let Some(duration) = style
        .filter(|s| s.kind.as_deref() == Some("trail"))
        .and_then(|s| s.trail_duration_seconds)
    {
        let Some(times) = epochs.filter(|t| t.len() == points.len()) else {
            return;
        };
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
                ((lo - epoch + duration) / duration) as f32,
                ((hi - epoch + duration) / duration) as f32,
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
    fn parent_inspection_keeps_child_trails_but_craft_inspection_hides_them() {
        let style = crate::TrajectoryStyle {
            kind: Some("trail".into()),
            origin_id: Some("earth".into()),
            ..Default::default()
        };
        assert_eq!(parent_trail_visibility(0., Some(&style), Some("earth")), 1.);
        assert_eq!(parent_trail_visibility(0., Some(&style), Some("iss")), 0.);
        assert_eq!(parent_trail_visibility(0., None, Some("earth")), 0.);
        assert_eq!(parent_trail_visibility(0.6, Some(&style), None), 0.6);
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
