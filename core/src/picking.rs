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

#[derive(Clone, Copy)]
pub(crate) struct PickRay {
    pub origin: [f64; 3],
    pub forward: [f64; 3],
    pub right_half: [f64; 3],
    pub up_half: [f64; 3],
}

// Only the renderer constructs these shapes in non-test builds.
#[cfg_attr(not(feature = "browser-render"), allow(dead_code))]
pub(crate) enum PickShape {
    Disc {
        center: [f32; 2],
        radius: f32,
    },
    Label {
        min: [f32; 2],
        size: [f32; 2],
    },
    Ring {
        ray: PickRay,
        center: [f64; 3],
        normal: [f64; 3],
        inner_radius: f64,
        outer_radius: f64,
    },
}

impl PickFrame {
    #[cfg(any(feature = "browser-render", test))]
    pub fn hover(&self, cursor: Option<[f32; 2]>, dragging: bool) -> Option<&str> {
        if dragging {
            return None;
        }
        let [u, v] = cursor?;
        self.pick(u, v)
    }

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
                    PickShape::Ring {
                        ray,
                        center,
                        normal,
                        inner_radius,
                        outer_radius,
                    } => {
                        if !inner_radius.is_finite()
                            || !outer_radius.is_finite()
                            || inner_radius < 0.
                            || outer_radius <= inner_radius
                        {
                            return false;
                        }
                        let direction: [f64; 3] = std::array::from_fn(|i| {
                            ray.forward[i]
                                + ray.right_half[i] * (2. * u as f64 - 1.)
                                + ray.up_half[i] * (1. - 2. * v as f64)
                        });
                        let denominator: f64 = (0..3).map(|i| direction[i] * normal[i]).sum();
                        if !denominator.is_finite() || denominator.abs() < 1e-12 {
                            return false;
                        }
                        let t = (0..3)
                            .map(|i| (center[i] - ray.origin[i]) * normal[i])
                            .sum::<f64>()
                            / denominator;
                        if !t.is_finite() || t <= 0. {
                            return false;
                        }
                        let radius2: f64 = (0..3)
                            .map(|i| (ray.origin[i] + direction[i] * t - center[i]).powi(2))
                            .sum();
                        radius2.is_finite()
                            && radius2 >= inner_radius * inner_radius
                            && radius2 <= outer_radius * outer_radius
                    }
                }
            })
            .min_by(|a, b| a.depth.total_cmp(&b.depth).then_with(|| a.id.cmp(&b.id)))
            .map(|target| target.id.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ring_ray_handles_perspective_holes_and_offscreen_centers() {
        let ray = PickRay {
            origin: [0., 0., 5.],
            forward: [0., 0., -1.],
            right_half: [1., 0., 0.],
            up_half: [0., 1., 0.],
        };
        let mut frame = PickFrame {
            viewport: [100., 100.],
            targets: vec![PickTarget {
                id: "saturn".into(),
                depth: 5.,
                shape: PickShape::Ring {
                    ray,
                    center: [0.; 3],
                    normal: [0., 0., 1.],
                    inner_radius: 1.,
                    outer_radius: 2.,
                },
            }],
        };
        assert_eq!(frame.pick(0.65, 0.5), Some("saturn"));
        assert_eq!(frame.pick(0.5, 0.5), None);
        assert_eq!(frame.pick(0.8, 0.8), None);
        frame.targets[0].shape = PickShape::Ring {
            ray,
            center: [6., 0., 0.],
            normal: [0., 1., 1.],
            inner_radius: 3.,
            outer_radius: 4.,
        };
        assert_eq!(
            frame.pick(0.7, 0.4),
            Some("saturn"),
            "inclined band remains pickable with center outside viewport"
        );
        assert_eq!(frame.hover(None, false), None);
    }
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
    fn hover_clears_on_leave_drag_and_no_hit() {
        let frame = PickFrame {
            viewport: [100., 100.],
            targets: vec![disc("body", 1., 10.)],
        };
        assert_eq!(frame.hover(Some([0.5, 0.5]), false), Some("body"));
        assert_eq!(frame.hover(None, false), None);
        assert_eq!(frame.hover(Some([0.5, 0.5]), true), None);
        assert_eq!(frame.hover(Some([0.9, 0.9]), false), None);
        assert_eq!(frame.hover(Some([0.599, 0.5]), false), Some("body"));
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
