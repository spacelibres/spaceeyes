//! Bounded CPU timings for fixed renderer stages; these are not GPU measurements.
use bevy::{platform::time::Instant, prelude::Resource};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
};
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Stage {
    Main,
    SyncScene,
    Annotations,
    TrajectoryUpload,
    Extract,
    Render,
}
impl Stage {
    fn name(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::SyncScene => "sync_scene",
            Self::Annotations => "annotations",
            Self::TrajectoryUpload => "trajectory_upload",
            Self::Extract => "extract",
            Self::Render => "render",
        }
    }
}
#[derive(Clone, Default, Resource)]
pub(crate) struct RenderTimings(
    Arc<Mutex<BTreeMap<Stage, VecDeque<f64>>>>,
    Arc<Mutex<RendererStartup>>,
);
#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RendererStartup {
    frames: u64,
    pending: usize,
    failed: usize,
    stable_frames: u64,
    #[serde(skip)]
    pipeline_count: usize,
}
#[derive(serde::Serialize)]
pub(crate) struct StageSnapshot {
    count: usize,
    latest: f64,
    mean: f64,
    p50: f64,
    p95: f64,
    p99: f64,
}
impl RenderTimings {
    pub(crate) fn record_startup(&self, pipeline_count: usize, pending: usize, failed: usize) {
        if let Ok(mut status) = self.1.lock() {
            status.frames += 1;
            status.stable_frames = if pipeline_count > 0
                && pending == 0
                && failed == 0
                && status.pipeline_count == pipeline_count
            {
                status.stable_frames + 1
            } else {
                0
            };
            status.pipeline_count = pipeline_count;
            status.pending = pending;
            status.failed = failed;
        }
    }
    pub(crate) fn startup_snapshot(&self) -> RendererStartup {
        self.1.lock().map(|status| *status).unwrap_or_default()
    }
    fn record(&self, stage: Stage, ms: f64) {
        if !ms.is_finite() || ms < 0. {
            return;
        }
        if let Ok(mut all) = self.0.lock() {
            let values = all.entry(stage).or_default();
            values.push_back(ms);
            if values.len() > 120 {
                values.pop_front();
            }
        }
    }
    pub(crate) fn snapshot(&self) -> BTreeMap<&'static str, StageSnapshot> {
        let Ok(all) = self.0.lock() else {
            return BTreeMap::new();
        };
        all.iter()
            .filter_map(|(stage, values)| {
                let latest = *values.back()?;
                let mut sorted: Vec<_> = values.iter().copied().collect();
                sorted.sort_by(f64::total_cmp);
                let p = |q: usize| sorted[(sorted.len() * q).div_ceil(100).saturating_sub(1)];
                Some((
                    stage.name(),
                    StageSnapshot {
                        count: sorted.len(),
                        latest,
                        mean: sorted.iter().sum::<f64>() / sorted.len() as f64,
                        p50: p(50),
                        p95: p(95),
                        p99: p(99),
                    },
                ))
            })
            .collect()
    }
    pub(crate) fn scope(&self, stage: Stage) -> StageTimer {
        StageTimer {
            timings: self.clone(),
            stage,
            start: Instant::now(),
        }
    }
}
pub(crate) struct StageTimer {
    timings: RenderTimings,
    stage: Stage,
    start: Instant,
}
impl Drop for StageTimer {
    fn drop(&mut self) {
        self.timings
            .record(self.stage, self.start.elapsed().as_secs_f64() * 1000.);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_requires_completed_pipeline_frames_and_resets_for_new_work() {
        let timings = RenderTimings::default();
        assert_eq!(timings.startup_snapshot().frames, 0);
        timings.record_startup(0, 0, 0);
        assert_eq!(timings.startup_snapshot().stable_frames, 0);
        timings.record_startup(3, 1, 0);
        assert_eq!(timings.startup_snapshot().stable_frames, 0);
        for _ in 0..3 {
            timings.record_startup(3, 0, 0);
        }
        assert_eq!(timings.startup_snapshot().stable_frames, 3);
        timings.record_startup(4, 0, 0);
        assert_eq!(timings.startup_snapshot().stable_frames, 0);
        timings.record_startup(4, 0, 1);
        assert_eq!(timings.startup_snapshot().failed, 1);
        assert_eq!(timings.startup_snapshot().stable_frames, 0);
    }
    #[test]
    fn bounded_quantiles_and_invalid_samples() {
        let timings = RenderTimings::default();
        for i in 1..=140 {
            timings.record(Stage::Main, i as f64);
        }
        for bad in [f64::NAN, f64::INFINITY, -1.] {
            timings.record(Stage::Main, bad);
        }
        let snapshots = timings.snapshot();
        let s = &snapshots["main"];
        assert_eq!(s.count, 120);
        assert_eq!((s.p50, s.p95, s.p99), (80., 134., 139.));
        assert_eq!(s.latest, 140.);
        assert_eq!(s.mean, 80.5);
    }
}
