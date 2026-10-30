//! Temporal polyline attachment uses core state, never a nearest spatial guess.
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
