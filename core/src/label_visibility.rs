//! Scientific-space annotation visibility, independent of floating-origin rendering.
use bevy::math::DVec3;

pub(crate) fn occluded(
    camera: DVec3,
    target: DVec3,
    spheres: &[(String, DVec3, f64)],
    id: &str,
) -> bool {
    let ray = target - camera;
    let distance = ray.length();
    if distance <= f64::EPSILON {
        return false;
    }
    let direction = ray / distance;
    spheres.iter().any(|(other, center, radius)| {
        if other == id || *radius <= 0. {
            return false;
        }
        let offset = *center - camera;
        let along = offset.dot(direction);
        let perpendicular2 = offset.length_squared() - along * along;
        if perpendicular2 >= radius * radius {
            return false;
        }
        let near = along - (radius * radius - perpendicular2.max(0.)).sqrt();
        near > 0. && near < distance
    })
}

#[derive(Default)]
pub(crate) struct Fade {
    pub alpha: f32,
    visible: bool,
}
impl Fade {
    pub fn update(&mut self, coverage: f32, allowed: bool, selected: bool, dt: f32) -> f32 {
        if selected {
            self.visible = false;
            self.alpha = 0.;
            return 0.;
        }
        self.visible = allowed && coverage < if self.visible { 0.12 } else { 0.10 };
        let target = if self.visible { 1. } else { 0. };
        self.alpha += (target - self.alpha) * (1. - (-dt.clamp(0., 0.1) / 0.09).exp());
        self.alpha
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn foreground_only_occludes_other_body() {
        let s = vec![("front".into(), DVec3::new(0., 0., 5.), 1.)];
        assert!(occluded(DVec3::ZERO, DVec3::new(0., 0., 10.), &s, "back"));
        assert!(!occluded(DVec3::ZERO, DVec3::new(0., 0., 5.), &s, "front"));
        assert!(!occluded(DVec3::ZERO, DVec3::new(0., 0., 2.), &s, "near"));
    }
    #[test]
    fn near_far_hysteresis_and_interaction_threshold() {
        let mut f = Fade::default();
        for _ in 0..30 {
            f.update(0.08, true, false, 0.016);
        }
        assert!(f.alpha > 0.9);
        f.update(0.11, true, false, 0.016);
        assert!(f.visible);
        for _ in 0..30 {
            f.update(0.13, true, false, 0.016);
        }
        assert!(f.alpha < 0.1);
        f.update(0.11, true, false, 0.016);
        assert!(!f.visible);
    }
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    #[test]
    fn disallowed_label_declines_and_projection_reset_restarts_fade() {
        let mut fade = Fade::default();
        for _ in 0..50 {
            fade.update(0., true, false, 0.016);
        }
        let previous = fade.alpha;
        let declining = fade.update(0., false, false, 0.016);
        assert!(declining > 0.5 && declining < previous);
        // Projection rejection discards this state, so re-entry starts translucent.
        let mut reset = Fade::default();
        assert!(reset.update(0., true, false, 0.016) < 0.5);
    }
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    #[test]
    fn selecting_hides_immediately_and_deselecting_only_restores_at_distance() {
        let mut f = Fade::default();
        for _ in 0..40 {
            f.update(0.01, true, false, 0.016);
        }
        assert!(f.alpha > 0.9);
        assert_eq!(f.update(0.01, true, true, 0.016), 0.);
        for _ in 0..40 {
            f.update(0.2, true, false, 0.016);
        }
        assert_eq!(f.alpha, 0.);
        for _ in 0..40 {
            f.update(0.05, true, false, 0.016);
        }
        assert!(f.alpha > 0.9);
    }
}

/// Wide Sun focus is still overview for the near/selection fade rule.
pub(crate) fn solar_overview(focused: Option<&str>, near: bool) -> bool {
    focused.is_none() || (focused == Some("sun") && !near)
}
