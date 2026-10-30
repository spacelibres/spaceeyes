//! Screen-space presentation never changes scientific positions or radii.
use bevy::prelude::*;

pub(crate) fn label_size(text: &str) -> Vec2 {
    Vec2::new((text.chars().count() as f32 * 8.5 + 4.).max(24.), 22.)
}

#[cfg(test)]
pub(crate) fn place_labels(
    items: Vec<(String, String, Vec2)>,
    viewport: Vec2,
    focused: Option<&str>,
) -> Vec<(String, String, Vec2)> {
    place_labels_measured(items, viewport, focused, &std::collections::HashMap::new())
}

pub(crate) fn place_labels_measured(
    mut items: Vec<(String, String, Vec2)>,
    viewport: Vec2,
    focused: Option<&str>,
    measured: &std::collections::HashMap<String, Vec2>,
) -> Vec<(String, String, Vec2)> {
    items.sort_by(|a, b| {
        (Some(a.0.as_str()) != focused)
            .cmp(&(Some(b.0.as_str()) != focused))
            .then_with(|| a.0.cmp(&b.0))
    });
    let mut boxes: Vec<(Vec2, Vec2)> = Vec::new();
    let mut placed = Vec::new();
    for (id, text, anchor) in items {
        let size = measured
            .get(&id)
            .copied()
            .unwrap_or_else(|| label_size(&text));
        if !anchor.is_finite()
            || anchor.x < 0.
            || anchor.y < 0.
            || anchor.x > viewport.x
            || anchor.y > viewport.y
        {
            continue;
        }
        let min = Vec2::new(8., 30.);
        let max = viewport - Vec2::new(8., 45.) - size;
        if !size.is_finite() || size.min_element() <= 0. || max.x < min.x || max.y < min.y {
            continue;
        }
        // Search nearby rows and columns each frame instead of dropping a name
        // after four occupied slots. Font bounds, viewport edges and padding all
        // participate in the same rectangle collision test.
        let mut candidates = Vec::with_capacity(52);
        for row in -6i32..=6 {
            for column in [0i32, -1, 1, -2] {
                let x = if column >= 0 {
                    12. + column as f32 * (size.x + 12.)
                } else {
                    column as f32 * (size.x + 12.)
                };
                let offset = Vec2::new(x, -size.y * 0.5 + row as f32 * (size.y + 8.));
                let lo = (anchor + offset).clamp(min, max);
                candidates.push(lo);
            }
        }
        candidates.sort_by(|a, b| {
            (anchor.distance_squared(*a + size * 0.5))
                .total_cmp(&anchor.distance_squared(*b + size * 0.5))
        });
        for lo in candidates {
            let hi = lo + size;
            if lo.x < 8. || lo.y < 30. || hi.x > viewport.x - 8. || hi.y > viewport.y - 45. {
                continue;
            }
            if boxes.iter().any(|(a, b)| {
                lo.x < b.x + 5. && hi.x + 5. > a.x && lo.y < b.y + 4. && hi.y + 4. > a.y
            }) {
                continue;
            }
            boxes.push((lo, hi));
            // Existing label nodes apply their own fixed anchor offset.
            placed.push((id, text, lo - Vec2::new(8., -8.)));
            break;
        }
    }
    placed
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clustered_labels_are_separated_and_focus_wins() {
        let items = (0..12)
            .map(|i| (i.to_string(), format!("BODY{i}"), Vec2::new(180., 160.)))
            .collect();
        let placed = place_labels(items, Vec2::new(400., 350.), Some("9"));
        assert_eq!(placed[0].0, "9");
        assert_eq!(
            placed.len(),
            12,
            "collision avoidance must retain this fitting cluster"
        );
        for (i, a) in placed.iter().enumerate() {
            for b in &placed[i + 1..] {
                assert!(
                    (a.2.y - b.2.y).abs() >= 26.
                        || a.2.x + (a.1.chars().count() as f32 * 8.5 + 4.).max(24.) + 5. <= b.2.x
                        || b.2.x + (b.1.chars().count() as f32 * 8.5 + 4.).max(24.) + 5. <= a.2.x
                );
            }
        }
    }
    #[test]
    fn labels_outside_view_are_not_piled_on_edges() {
        assert!(
            place_labels(
                vec![("x".into(), "BODY".into(), Vec2::splat(-200.))],
                Vec2::new(400., 300.),
                None
            )
            .is_empty()
        );
    }
}

#[cfg(test)]
mod measured_tests {
    use super::*;
    #[test]
    fn actual_font_bounds_control_placement() {
        let items = vec![("a".into(), "A".into(), Vec2::new(100., 100.))];
        let measured = std::collections::HashMap::from([("a".into(), Vec2::new(500., 30.))]);
        assert!(place_labels_measured(items, Vec2::new(400., 300.), None, &measured).is_empty());
    }
}

#[cfg(test)]
mod moving_cluster_tests {
    use super::*;
    #[test]
    fn dense_planet_names_relocate_each_frame_without_overlapping_or_disappearing() {
        let names = [
            "SUN", "MERCURY", "VENUS", "EARTH", "MOON", "MARS", "JUPITER", "SATURN", "URANUS",
            "NEPTUNE",
        ];
        for frame in 0..60 {
            let phase = frame as f32 * 0.1;
            let items = names
                .iter()
                .enumerate()
                .map(|(i, name)| {
                    (
                        name.to_string(),
                        name.to_string(),
                        Vec2::new(
                            160. + (phase + i as f32).sin() * 8.,
                            120. + (phase * 0.7 + i as f32).cos() * 8.,
                        ),
                    )
                })
                .collect();
            let result = place_labels(items, Vec2::new(320., 280.), Some("SUN"));
            assert_eq!(result.len(), names.len(), "frame {frame}");
            for (i, a) in result.iter().enumerate() {
                let lo = a.2 + Vec2::new(8., -8.);
                let hi = lo + label_size(&a.1);
                assert!(lo.x >= 8. && lo.y >= 30. && hi.x <= 312. && hi.y <= 235.);
                for b in &result[i + 1..] {
                    let blo = b.2 + Vec2::new(8., -8.);
                    let bhi = blo + label_size(&b.1);
                    assert!(
                        lo.x >= bhi.x + 5.
                            || hi.x + 5. <= blo.x
                            || lo.y >= bhi.y + 4.
                            || hi.y + 4. <= blo.y,
                        "frame {frame}: {} / {}",
                        a.0,
                        b.0
                    );
                }
            }
        }
    }
}
