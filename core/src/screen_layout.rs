//! Stable object-attached labels; collisions suppress names rather than relocate them.
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};
pub(crate) fn label_size(text: &str) -> Vec2 {
    Vec2::new((text.chars().count() as f32 * 8.5 + 4.).max(24.), 22.)
}
#[derive(Default)]
pub(crate) struct LabelLayout {
    pub priorities: HashMap<String, (u32, f64)>,
}
impl LabelLayout {
    pub fn place(
        &mut self,
        mut items: Vec<(String, String, Vec2)>,
        viewport: Vec2,
        focused: Option<&str>,
        measured: &HashMap<String, Vec2>,
        _alive: &HashSet<String>,
    ) -> Vec<(String, String, Vec2)> {
        // Stable priority never depends on last frame's accepted set.
        items.sort_by(|a, b| {
            (Some(a.0.as_str()) != focused)
                .cmp(&(Some(b.0.as_str()) != focused))
                .then_with(|| {
                    let a = self
                        .priorities
                        .get(&a.0)
                        .copied()
                        .unwrap_or((0, f64::INFINITY));
                    let b = self
                        .priorities
                        .get(&b.0)
                        .copied()
                        .unwrap_or((0, f64::INFINITY));
                    b.0.cmp(&a.0).then_with(|| a.1.total_cmp(&b.1))
                })
                .then_with(|| a.0.cmp(&b.0))
        });
        let mut boxes: Vec<(Vec2, Vec2)> = Vec::new();
        items
            .into_iter()
            .filter(|(id, text, anchor)| {
                let size = measured
                    .get(id)
                    .copied()
                    .unwrap_or_else(|| label_size(text));
                let lo = *anchor + Vec2::new(8., -8.);
                let hi = lo + size;
                if !anchor.is_finite()
                    || !size.is_finite()
                    || size.min_element() <= 0.
                    || lo.x < 8.
                    || lo.y < 30.
                    || hi.x > viewport.x - 8.
                    || hi.y > viewport.y - 45.
                {
                    return false;
                }
                if boxes.iter().any(|(a, b)| {
                    lo.x < b.x + 5. && hi.x + 5. > a.x && lo.y < b.y + 4. && hi.y + 4. > a.y
                }) {
                    return false;
                }
                boxes.push((lo, hi));
                true
            })
            .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dense_cluster_keeps_priority_and_original_anchor_across_frames() {
        let mut layout = LabelLayout::default();
        let items: Vec<_> = (0..200)
            .map(|i| (i.to_string(), "BODY".into(), Vec2::splat(100.)))
            .collect();
        for frame in 0..60 {
            let mut input = items.clone();
            if frame % 2 == 0 {
                input.reverse();
            }
            let result = layout.place(
                input,
                Vec2::splat(500.),
                Some("9"),
                &HashMap::new(),
                &HashSet::new(),
            );
            assert_eq!(result, vec![("9".into(), "BODY".into(), Vec2::splat(100.))]);
        }
    }
    #[test]
    fn rejects_offscreen_without_clamping() {
        assert!(
            LabelLayout::default()
                .place(
                    vec![("a".into(), "A".into(), Vec2::splat(-10.))],
                    Vec2::splat(500.),
                    None,
                    &HashMap::new(),
                    &HashSet::new()
                )
                .is_empty()
        );
    }
}

#[cfg(test)]
mod priority_tests {
    use super::*;
    #[test]
    fn weight_then_depth_then_name_decides_collisions() {
        let mut layout = LabelLayout::default();
        layout.priorities = HashMap::from([
            ("a".into(), (30, 1.)),
            ("b".into(), (50, 9.)),
            ("c".into(), (50, 3.)),
            ("d".into(), (50, 3.)),
        ]);
        let items = ["d", "c", "b", "a"]
            .into_iter()
            .map(|id| (id.into(), id.into(), Vec2::splat(100.)))
            .collect();
        let result = layout.place(
            items,
            Vec2::splat(500.),
            None,
            &HashMap::new(),
            &HashSet::new(),
        );
        assert_eq!(result[0].0, "c");
    }
}
