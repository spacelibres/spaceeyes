//! Host-only hit queries over the latest rendered camera projection.
pub(crate) type SharedPickFrame = std::sync::Arc<std::sync::Mutex<PickFrame>>;
#[derive(Default)]
pub(crate) struct PickFrame {
    pub viewport: [f32; 2],
    pub targets: Vec<PickTarget>,
}

pub(crate) struct PickTarget {
    pub id: String,
    pub depth: f32,
    pub shape: PickShape,
}

// Only the renderer constructs these shapes in non-test builds.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) enum PickShape {
    Disc { center: [f32; 2], radius: f32 },
    Label { min: [f32; 2], size: [f32; 2] },
}

impl PickFrame {
    pub fn pick(&self, u: f32, v: f32) -> Option<&str> {
        if !u.is_finite()
            || !v.is_finite()
            || !(0.0..=1.0).contains(&u)
            || !(0.0..=1.0).contains(&v)
            || self.viewport.iter().any(|n| !n.is_finite() || *n <= 0.)
        {
            return None;
        }
        let p = [u * self.viewport[0], v * self.viewport[1]];
        self.targets
            .iter()
            .filter(|target| {
                if !target.depth.is_finite() || target.depth <= 0. {
                    return false;
                }
                match target.shape {
                    PickShape::Disc { center, radius } => {
                        radius.is_finite()
                            && radius > 0.
                            && (p[0] - center[0]).hypot(p[1] - center[1]) <= radius
                    }
                    PickShape::Label { min, size } => (0..2).all(|i| {
                        min[i].is_finite()
                            && size[i].is_finite()
                            && size[i] > 0.
                            && p[i] >= min[i]
                            && p[i] <= min[i] + size[i]
                    }),
                }
            })
            .min_by(|a, b| a.depth.total_cmp(&b.depth).then_with(|| a.id.cmp(&b.id)))
            .map(|target| target.id.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn disc(id: &str, depth: f32, radius: f32) -> PickTarget {
        PickTarget {
            id: id.into(),
            depth,
            shape: PickShape::Disc {
                center: [50., 50.],
                radius,
            },
        }
    }
    #[test]
    fn overlapping_discs_select_nearest_visible_body() {
        let frame = PickFrame {
            viewport: [100., 100.],
            targets: vec![disc("back", 20., 30.), disc("front", 10., 20.)],
        };
        assert_eq!(frame.pick(0.5, 0.5), Some("front"));
        assert_eq!(frame.pick(0.75, 0.5), Some("back"));
        assert_eq!(frame.pick(0.99, 0.99), None);
    }
    #[test]
    fn placed_label_is_pickable_but_does_not_select_through_nearer_body() {
        let mut frame = PickFrame {
            viewport: [200., 100.],
            targets: vec![PickTarget {
                id: "label".into(),
                depth: 20.,
                shape: PickShape::Label {
                    min: [80., 40.],
                    size: [60., 22.],
                },
            }],
        };
        assert_eq!(frame.pick(0.5, 0.5), Some("label"));
        frame.targets.push(PickTarget {
            id: "front".into(),
            depth: 10.,
            shape: PickShape::Disc {
                center: [100., 50.],
                radius: 15.,
            },
        });
        assert_eq!(frame.pick(0.5, 0.5), Some("front"));
    }
    #[test]
    fn invalid_coordinates_and_cleared_frames_never_hit() {
        let mut frame = PickFrame {
            viewport: [100., 100.],
            targets: vec![disc("body", 1., 200.)],
        };
        for (u, v) in [
            (f32::NAN, 0.5),
            (f32::INFINITY, 0.5),
            (-0.01, 0.5),
            (1.01, 0.5),
        ] {
            assert_eq!(frame.pick(u, v), None);
        }
        frame.targets.clear();
        assert_eq!(frame.pick(0.5, 0.5), None);
        frame.targets.push(disc("body", 1., 200.));
        frame.viewport = [0., 100.];
        assert_eq!(frame.pick(0.5, 0.5), None);
    }
    #[test]
    fn depth_ties_are_stable_and_invalid_targets_are_ignored() {
        let frame = PickFrame {
            viewport: [100., 100.],
            targets: vec![
                disc("z", 1., 12.),
                disc("bad", f32::NAN, 12.),
                disc("a", 1., 12.),
            ],
        };
        assert_eq!(frame.pick(0.5, 0.5), Some("a"));
    }
}
