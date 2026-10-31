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

#[cfg(test)]
pub(crate) fn place_labels_measured(
    items: Vec<(String, String, Vec2)>,
    viewport: Vec2,
    focused: Option<&str>,
    measured: &std::collections::HashMap<String, Vec2>,
) -> Vec<(String, String, Vec2)> {
    place_with_memory(
        items,
        viewport,
        focused,
        measured,
        &std::collections::HashMap::new(),
    )
}

#[derive(Default)]
pub(crate) struct LabelLayout {
    offsets: std::collections::HashMap<String, Vec2>,
}
impl LabelLayout {
    pub fn place(
        &mut self,
        items: Vec<(String, String, Vec2)>,
        viewport: Vec2,
        focused: Option<&str>,
        measured: &std::collections::HashMap<String, Vec2>,
        alive: &std::collections::HashSet<String>,
    ) -> Vec<(String, String, Vec2)> {
        self.offsets.retain(|id, _| alive.contains(id));
        let anchors: std::collections::HashMap<_, _> =
            items.iter().map(|(id, _, p)| (id.clone(), *p)).collect();
        let placed = place_with_memory(items, viewport, focused, measured, &self.offsets);
        for (id, _, p) in &placed {
            if let Some(anchor) = anchors.get(id) {
                self.offsets
                    .insert(id.clone(), *p + Vec2::new(8., -8.) - *anchor);
            }
        }
        placed
    }
}

fn place_with_memory(
    mut items: Vec<(String, String, Vec2)>,
    viewport: Vec2,
    focused: Option<&str>,
    measured: &std::collections::HashMap<String, Vec2>,
    previous: &std::collections::HashMap<String, Vec2>,
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
        let preferred = previous
            .get(&id)
            .map(|offset| (anchor + *offset).clamp(min, max));
        if let Some(lo) = preferred {
            candidates.insert(0, lo);
        }
        for (index, lo) in candidates.into_iter().enumerate() {
            let hi = lo + size;
            if lo.x < 8. || lo.y < 30. || hi.x > viewport.x - 8. || hi.y > viewport.y - 45. {
                continue;
            }
            // Keep an existing non-overlapping slot through small projection
            // changes; newly selected slots leave a larger separation margin.
            let gap = if preferred.is_some() && index == 0 {
                Vec2::splat(1.)
            } else {
                Vec2::new(5., 4.)
            };
            if boxes.iter().any(|(a, b)| {
                lo.x < b.x + gap.x && hi.x + gap.x > a.x && lo.y < b.y + gap.y && hi.y + gap.y > a.y
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

#[cfg(test)]
mod stable_layout_tests {
    use super::*;
    #[test]
    fn small_projection_noise_keeps_slots_and_still_avoids_collisions() {
        let mut layout = LabelLayout::default();
        let make = |phase: f32| {
            (0..10)
                .map(|i| {
                    (
                        i.to_string(),
                        format!("BODY{i}"),
                        Vec2::new(
                            190. + (i as f32 + phase).sin() * 0.2,
                            140. + (i as f32 + phase).cos() * 0.2,
                        ),
                    )
                })
                .collect::<Vec<_>>()
        };
        let alive = make(0.).iter().map(|v| v.0.clone()).collect();
        let first = layout.place(
            make(0.),
            Vec2::new(500., 420.),
            Some("0"),
            &Default::default(),
            &alive,
        );
        assert_eq!(first.len(), 10);
        for n in 1..120 {
            let next = layout.place(
                make(n as f32 * 0.1),
                Vec2::new(500., 420.),
                Some("0"),
                &Default::default(),
                &alive,
            );
            assert_eq!(next.len(), 10);
            for row in &next {
                let old = first.iter().find(|v| v.0 == row.0).unwrap();
                assert!(
                    row.2.distance(old.2) < 1.,
                    "slot jumped for {} at frame {n}",
                    row.0
                );
            }
            for (i, a) in next.iter().enumerate() {
                for b in next.iter().skip(i + 1) {
                    let a0 = a.2 + Vec2::new(8., -8.);
                    let b0 = b.2 + Vec2::new(8., -8.);
                    let asize = label_size(&a.1);
                    let bsize = label_size(&b.1);
                    assert!(
                        a0.x + asize.x <= b0.x
                            || b0.x + bsize.x <= a0.x
                            || a0.y + asize.y <= b0.y
                            || b0.y + bsize.y <= a0.y
                    );
                }
            }
        }
        layout.place(
            vec![],
            Vec2::new(500., 420.),
            None,
            &Default::default(),
            &Default::default(),
        );
        assert!(layout.offsets.is_empty());
    }
}
