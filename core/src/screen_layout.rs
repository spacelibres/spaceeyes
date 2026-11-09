//! NASA-style anchored labels: bounded overlap updates, persistent states and CSS-time fades.
use bevy::prelude::*;
use std::collections::{HashMap, HashSet};
pub(crate) fn label_size(text: &str) -> Vec2 {
    Vec2::new((text.chars().count() as f32 * 8.5 + 4.).max(24.), 22.)
}
pub(crate) fn label_origin(id: &str, anchor: Vec2) -> Vec2 {
    let offset = if id == "sun" {
        Vec2::new(20., 8.)
    } else if matches!(
        id,
        "mercury" | "venus" | "earth" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune"
    ) {
        Vec2::new(18., -6.)
    } else if id.starts_with("sc_") {
        Vec2::new(14., -4.)
    } else {
        Vec2::new(12., -4.)
    };
    anchor.round() + offset
}
#[derive(Default)]
struct Entry {
    lo: Vec2,
    hi: Vec2,
    hidden: bool,
    alpha: f32,
    from: f32,
    target: f32,
    elapsed: f32,
}
pub(crate) struct LabelLayout {
    pub priorities: HashMap<String, (u32, f64)>,
    pub delta_secs: f32,
    pub hovered: Option<String>,
    entries: HashMap<String, Entry>,
    cells: HashMap<(i32, i32), HashSet<String>>,
    cursor: usize,
    #[cfg(test)]
    processed: usize,
}
impl Default for LabelLayout {
    fn default() -> Self {
        Self {
            priorities: HashMap::new(),
            delta_secs: 1. / 60.,
            hovered: None,
            entries: HashMap::new(),
            cells: HashMap::new(),
            cursor: 0,
            #[cfg(test)]
            processed: 0,
        }
    }
}

fn cells(lo: Vec2, hi: Vec2) -> impl Iterator<Item = (i32, i32)> {
    let a = (lo / 128.).floor().as_ivec2();
    let b = (hi / 128.).floor().as_ivec2();
    (a.x..=b.x).flat_map(move |x| (a.y..=b.y).map(move |y| (x, y)))
}
// CSS ease-out = cubic-bezier(0,0,.58,1), evaluated against elapsed wall time.
fn ease_out(x: f32) -> f32 {
    if x <= 0. {
        return 0.;
    }
    if x >= 1. {
        return 1.;
    }
    let (mut lo, mut hi) = (0., 1.);
    for _ in 0..16 {
        let t = (lo + hi) * 0.5;
        let bx = 3. * (1. - t) * t * t * 0.58 + t * t * t;
        if bx < x {
            lo = t;
        } else {
            hi = t;
        }
    }
    let t = (lo + hi) * 0.5;
    3. * (1. - t) * t * t + t * t * t
}
impl LabelLayout {
    pub fn opacity(&self, id: &str) -> f32 {
        self.entries.get(id).map_or(0., |e| e.alpha)
    }
    pub fn interactive(&self, id: &str) -> bool {
        self.entries.get(id).is_some_and(|e| !e.hidden)
    }
    fn remove_bounds(
        entries: &HashMap<String, Entry>,
        index: &mut HashMap<(i32, i32), HashSet<String>>,
        id: &str,
    ) {
        if let Some(e) = entries.get(id) {
            for key in cells(e.lo, e.hi) {
                if let Some(bucket) = index.get_mut(&key) {
                    bucket.remove(id);
                }
            }
        }
    }
    pub fn place(
        &mut self,
        mut items: Vec<(String, String, Vec2)>,
        viewport: Vec2,
        focused: Option<&str>,
        measured: &HashMap<String, Vec2>,
        _alive: &HashSet<String>,
    ) -> Vec<(String, String, Vec2)> {
        items.retain(|(id, text, anchor)| {
            let size = measured
                .get(id)
                .copied()
                .unwrap_or_else(|| label_size(text));
            let lo = label_origin(id, *anchor);
            let hi = lo + size;
            anchor.is_finite()
                && size.is_finite()
                && size.min_element() > 0.
                && lo.x < viewport.x
                && lo.y < viewport.y
                && hi.x > 0.
                && hi.y > 0.
        });
        for (_, _, anchor) in &mut items {
            *anchor = Vec2::new(
                if (viewport.x as u32).is_multiple_of(2) {
                    anchor.x.round()
                } else {
                    anchor.x.floor()
                },
                if (viewport.y as u32).is_multiple_of(2) {
                    anchor.y.round()
                } else {
                    anchor.y.floor()
                },
            );
        }
        let live: HashSet<_> = items.iter().map(|i| i.0.clone()).collect();
        let removed: Vec<_> = self
            .entries
            .keys()
            .filter(|id| !live.contains(*id))
            .cloned()
            .collect();
        for id in removed {
            Self::remove_bounds(&self.entries, &mut self.cells, &id);
            self.entries.remove(&id);
        }
        let priority = |id: &str| {
            let (weight, z) = self
                .priorities
                .get(id)
                .copied()
                .unwrap_or((0, f64::INFINITY));
            (if Some(id) == focused { 201 } else { weight }, z)
        };
        // Stable ascending weights, as in NASA's rotation list. Name resolves ties deterministically.
        items.sort_by(|a, b| priority(&a.0).0.cmp(&priority(&b.0).0).then(a.0.cmp(&b.0)));
        let count = items.len();
        #[cfg(test)]
        {
            self.processed = count.min(20);
        }
        if count == 0 {
            self.cursor = 0;
            self.cells.clear();
            return items;
        }
        let start = self.cursor % count;
        // New entries have bounds immediately; subsequent geometry refreshes are bounded to 20.
        for (id, text, anchor) in &items {
            if !self.entries.contains_key(id) {
                let lo = label_origin(id, *anchor).max(Vec2::ZERO);
                let hi = (label_origin(id, *anchor)
                    + measured
                        .get(id)
                        .copied()
                        .unwrap_or_else(|| label_size(text)))
                .min(viewport);
                self.entries.insert(
                    id.clone(),
                    Entry {
                        lo,
                        hi,
                        ..default()
                    },
                );
                for key in cells(lo, hi) {
                    self.cells.entry(key).or_default().insert(id.clone());
                }
            }
        }
        for index in 0..count.min(20) {
            let (id, text, anchor) = &items[(start + index) % count];
            Self::remove_bounds(&self.entries, &mut self.cells, id);
            let e = self.entries.get_mut(id).unwrap();
            e.lo = label_origin(id, *anchor).max(Vec2::ZERO);
            e.hi = (label_origin(id, *anchor)
                + measured
                    .get(id)
                    .copied()
                    .unwrap_or_else(|| label_size(text)))
            .min(viewport);
            for key in cells(e.lo, e.hi) {
                self.cells.entry(key).or_default().insert(id.clone());
            }
        }
        for index in 0..count.min(20) {
            let id = &items[(start + index) % count].0;
            let e = &self.entries[id];
            let (weight, z) = priority(id);
            let hidden = cells(e.lo, e.hi)
                .filter_map(|key| self.cells.get(&key))
                .flatten()
                .any(|other| {
                    if other == id {
                        return false;
                    }
                    let o = &self.entries[other];
                    if o.hidden {
                        return false;
                    }
                    let (ow, oz) = priority(other);
                    let loses =
                        weight < ow || (weight == ow && (z > oz || (z == oz && id < other)));
                    loses
                        && e.lo.x < o.hi.x
                        && e.hi.x > o.lo.x
                        && e.lo.y < o.hi.y
                        && e.hi.y > o.lo.y
                });
            self.entries.get_mut(id).unwrap().hidden = hidden;
        }
        self.cursor = (start + count.min(20)) % count;
        self.cells.retain(|_, bucket| !bucket.is_empty());
        let dt = if self.delta_secs.is_finite() {
            self.delta_secs.max(0.)
        } else {
            0.
        };
        for (id, e) in &mut self.entries {
            let weight = self.priorities.get(id).map_or(0, |p| p.0);
            let target = if e.hidden {
                0.
            } else if self.hovered.as_deref() == Some(id) {
                1.
            } else if weight >= 50 {
                0.75
            } else {
                0.35
            };
            if e.target != target {
                e.from = e.alpha;
                e.target = target;
                e.elapsed = 0.;
            }
            e.elapsed += dt;
            let duration = if e.hidden { 0.75 } else { 0.25 };
            let t = (e.elapsed / duration).min(1.);
            e.alpha = if t >= 1. {
                target
            } else {
                e.from + (target - e.from) * ease_out(t)
            };
        }
        items.retain(|(id, _, _)| self.entries[id].alpha > 0.001);
        items
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn frame(l: &mut LabelLayout, ids: &[&str]) -> Vec<(String, String, Vec2)> {
        l.place(
            ids.iter()
                .map(|id| ((*id).into(), (*id).into(), Vec2::new(100.2, 100.4)))
                .collect(),
            Vec2::splat(500.),
            None,
            &HashMap::new(),
            &HashSet::new(),
        )
    }
    #[test]
    fn overlap_uses_weight_depth_then_name_and_never_relocates() {
        let mut l = LabelLayout::default();
        l.priorities = HashMap::from([
            ("a".into(), (30, 1.)),
            ("b".into(), (50, 9.)),
            ("c".into(), (50, 3.)),
            ("d".into(), (50, 3.)),
        ]);
        for _ in 0..60 {
            frame(&mut l, &["a", "b", "c", "d"]);
        }
        let out = frame(&mut l, &["d", "c", "b", "a"]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "d");
        assert_eq!(out[0].2, Vec2::splat(100.));
    }
    #[test]
    fn batch_is_bounded_and_all_labels_eventually_receive_a_turn() {
        let mut l = LabelLayout::default();
        let ids: Vec<_> = (0..200).map(|i| format!("{i:03}")).collect();
        let refs: Vec<_> = ids.iter().map(String::as_str).collect();
        for _ in 0..100 {
            frame(&mut l, &refs);
            assert_eq!(l.processed, 20);
        }
        assert_eq!(frame(&mut l, &refs).len(), 1);
        assert!(l.interactive("199"));
    }
    #[test]
    fn visible_labels_use_category_opacity_and_hover_without_losing_clicks() {
        let mut l = LabelLayout::default();
        for _ in 0..30 {
            frame(&mut l, &["sc_a"]);
        }
        assert!((l.opacity("sc_a") - 0.35).abs() < 1e-5);
        assert!(l.interactive("sc_a"));
        l.hovered = Some("sc_a".into());
        for _ in 0..20 {
            frame(&mut l, &["sc_a"]);
        }
        assert_eq!(l.opacity("sc_a"), 1.);
    }
    #[test]
    fn collision_fades_out_and_removal_clears_index() {
        let mut l = LabelLayout::default();
        for _ in 0..20 {
            frame(&mut l, &["a"]);
        }
        l.priorities.insert("b".into(), (100, 1.));
        frame(&mut l, &["a", "b"]);
        assert!(!l.interactive("a"));
        assert!(l.opacity("a") > 0.);
        for _ in 0..50 {
            frame(&mut l, &["a", "b"]);
        }
        assert_eq!(l.opacity("a"), 0.);
        frame(&mut l, &[]);
        assert!(l.entries.is_empty());
        assert!(l.cells.is_empty());
    }
    #[test]
    fn edge_labels_are_not_clamped_or_relocated() {
        let mut l = LabelLayout::default();
        let out = l.place(
            vec![("a".into(), "A".into(), Vec2::new(-15.2, 10.3))],
            Vec2::splat(500.),
            None,
            &HashMap::new(),
            &HashSet::new(),
        );
        assert_eq!(out[0].2, Vec2::new(-15., 10.));
        assert_eq!(label_origin("earth", Vec2::splat(10.3)), Vec2::new(28., 4.));
    }
    #[test]
    fn fades_follow_wall_time_at_both_frame_rates() {
        for fps in [30, 60] {
            let mut l = LabelLayout {
                delta_secs: 1. / fps as f32,
                ..default()
            };
            for _ in 0..fps {
                frame(&mut l, &["a"]);
            }
            assert!((l.opacity("a") - 0.35).abs() < 1e-6);
            l.priorities.insert("b".into(), (100, 1.));
            for _ in 0..fps / 2 {
                frame(&mut l, &["a", "b"]);
            }
            assert!(l.opacity("a") > 0. && l.opacity("a") < 0.35);
            for _ in 0..fps / 2 {
                frame(&mut l, &["a", "b"]);
            }
            assert_eq!(l.opacity("a"), 0.);
        }
    }
    #[test]
    fn odd_viewport_snaps_down_without_clamping() {
        let mut l = LabelLayout::default();
        let out = l.place(
            vec![("a".into(), "A".into(), Vec2::splat(100.7))],
            Vec2::splat(501.),
            None,
            &HashMap::new(),
            &HashSet::new(),
        );
        assert_eq!(out[0].2, Vec2::splat(100.));
    }
    #[test]
    fn zero_and_long_frames_preserve_wall_time() {
        let mut l = LabelLayout {
            delta_secs: 0.,
            ..default()
        };
        frame(&mut l, &["a"]);
        assert_eq!(
            l.opacity("a"),
            0.,
            "zero elapsed time must not advance a transition"
        );
        l.delta_secs = 0.25;
        frame(&mut l, &["a"]);
        assert!(
            (l.opacity("a") - 0.35).abs() < 1e-6,
            "a 250ms frame must finish the 250ms appearance"
        );
        l.priorities.insert("b".into(), (100, 1.));
        l.delta_secs = 0.75;
        frame(&mut l, &["a", "b"]);
        assert_eq!(
            l.opacity("a"),
            0.,
            "a 750ms frame must finish disappearance"
        );
    }
}
