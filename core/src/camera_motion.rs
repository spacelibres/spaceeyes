/// A drag interrupted outside the canvas needs a fresh button press.
#[derive(Default)]
pub(crate) struct DragGate {
    suspended: bool,
}
impl DragGate {
    pub(crate) fn accept(&mut self, available: bool, held: bool, fresh: bool) -> bool {
        if !available {
            self.suspended = true;
            return false;
        }
        if fresh {
            self.suspended = false;
        }
        held && !self.suspended
    }
}
/// Mouse-only motion; never apply this filter to tracked head poses.
#[derive(Clone, Default)]
pub(crate) struct Motion {
    velocity: [f32; 2],
    remaining: f32,
    zoom_pending: f32,
}
impl Motion {
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }
    pub(crate) fn drag(&mut self, delta: [f32; 2], dt: f32) {
        let dt = dt.clamp(1. / 240., 0.1);
        self.velocity = delta.map(|v| (v / dt).clamp(-0.8, 0.8));
        let speed = self.velocity[0].hypot(self.velocity[1]);
        if speed > 0.8 {
            self.velocity = self.velocity.map(|v| v * 0.8 / speed);
        }
        self.remaining = 0.3;
    }
    pub(crate) fn coast(&mut self, dt: f32) -> [f32; 2] {
        if !dt.is_finite() || dt <= 0. {
            return [0.; 2];
        }
        let step = dt.min(self.remaining);
        self.remaining = (self.remaining - dt).max(0.);
        let k = std::f32::consts::LN_2 / 0.07;
        let decay = (-k * step).exp();
        let result = self.velocity.map(|v| v * (1. - decay) / k);
        self.velocity = self.velocity.map(|v| v * decay);
        if self.remaining <= 1e-6 {
            self.velocity = [0.; 2];
        }
        result
    }
    pub(crate) fn zoom(&mut self, amount: f32) {
        if amount.is_finite() {
            if self.zoom_pending * amount < 0. {
                self.zoom_pending = 0.;
            }
            self.zoom_pending = (self.zoom_pending + amount).clamp(-4., 4.);
        }
    }
    pub(crate) fn zoom_step(&mut self, dt: f32) -> f32 {
        if !dt.is_finite() || dt <= 0. {
            return 0.;
        }
        let step = self.zoom_pending * (1. - (-std::f32::consts::LN_2 * dt / 0.045).exp());
        self.zoom_pending -= step;
        step
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reentry_requires_fresh_press() {
        let mut gate = DragGate::default();
        assert!(gate.accept(true, true, true));
        assert!(!gate.accept(false, true, false));
        assert!(!gate.accept(true, true, false));
        assert!(!gate.accept(true, false, false));
        assert!(gate.accept(true, true, true));
    }

    #[test]
    fn decay_is_frame_independent_and_bounded() {
        let mut a = Motion::default();
        a.drag([1., 0.], 0.001);
        let mut b = a.clone();
        let x: f32 = (0..30).map(|_| a.coast(0.01)[0]).sum();
        let y: f32 = (0..3).map(|_| b.coast(0.1)[0]).sum();
        assert!((x - y).abs() < 1e-6);
        assert!(x <= 5_f32.to_radians());
        assert_eq!(a.coast(0.01), [0., 0.]);
    }
    #[test]
    fn reset_stops_every_axis() {
        let mut a = Motion::default();
        a.drag([0.01, 0.02], 0.016);
        a.zoom(2.);
        a.clear();
        assert_eq!(a.coast(0.016), [0., 0.]);
        assert_eq!(a.zoom_step(0.016), 0.);
    }
    #[test]
    fn reversal_replaces_velocity() {
        let mut a = Motion::default();
        a.drag([0.02, 0.], 0.016);
        a.drag([-0.01, 0.], 0.016);
        assert!(a.coast(0.016)[0] < 0.);
    }
    #[test]
    fn logarithmic_zoom_partition() {
        let mut a = Motion::default();
        a.zoom(0.5);
        let mut b = a.clone();
        let x: f32 = (0..10).map(|_| a.zoom_step(0.01)).sum();
        assert!((x - b.zoom_step(0.1)).abs() < 1e-6);
    }
}
