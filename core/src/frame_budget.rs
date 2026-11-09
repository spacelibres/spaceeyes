//! Wall-clock admission for the actual Bevy render sub-app.
use bevy::ecs::schedule::{InternedScheduleLabel, ScheduleLabel};
use bevy::platform::time::Instant;
use bevy::prelude::*;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
#[derive(Clone, Debug, serde::Serialize)]
pub struct FrameBudgetSnapshot {
    pub noncritical_pending: u32,
    /// Compatibility telemetry: full resolution is invariant; cadence never changes quality.
    pub resolution_scale: f64,
    pub target_fps: u32,
    pub rendered_frames: u64,
    /// Minimum submissions in a trailing one-second window ending at admission.
    pub worst_one_second_frames: Option<usize>,
    pub skipped_frames: u64,
    /// Admitted render submission intervals, not GPU completion times.
    pub present_interval_p50_ms: Option<f64>,
    pub present_interval_p95_ms: Option<f64>,
    pub present_interval_p99_ms: Option<f64>,
    pub transition_seconds: Option<f64>,
    pub transition_reason: Option<String>,
    pub cpu_p50_ms: Option<f64>,
    pub cpu_p95_ms: Option<f64>,
    pub cpu_p99_ms: Option<f64>,
    pub gpu_ms: Option<f64>,
    pub visible: bool,
}
#[derive(Debug)]
pub struct FrameBudget {
    timestamps: VecDeque<f64>,
    window_start: Option<f64>,
    next_due: Option<f64>,
    last: Option<f64>,
    overload: Option<f64>,
    recovery: Option<f64>,
    intervals: VecDeque<f64>,
    samples: VecDeque<f64>,
    snapshot: FrameBudgetSnapshot,
}
impl Default for FrameBudget {
    fn default() -> Self {
        Self {
            timestamps: VecDeque::new(),
            window_start: None,
            next_due: None,
            last: None,
            overload: None,
            recovery: None,
            intervals: VecDeque::new(),
            samples: VecDeque::new(),
            snapshot: FrameBudgetSnapshot {
                noncritical_pending: 0,
                resolution_scale: 1.,
                target_fps: 60,
                rendered_frames: 0,
                worst_one_second_frames: None,
                skipped_frames: 0,
                present_interval_p50_ms: None,
                present_interval_p95_ms: None,
                present_interval_p99_ms: None,
                transition_seconds: None,
                transition_reason: None,
                cpu_p50_ms: None,
                cpu_p95_ms: None,
                cpu_p99_ms: None,
                gpu_ms: None,
                visible: true,
            },
        }
    }
}
impl FrameBudget {
    pub fn set_noncritical_pending(&mut self, pending: u32) {
        self.snapshot.noncritical_pending = pending;
    }
    pub fn snapshot(&self) -> FrameBudgetSnapshot {
        self.snapshot.clone()
    }
    pub fn set_visible(&mut self, visible: bool) {
        if self.snapshot.visible != visible {
            self.timestamps.clear();
            self.window_start = None;
            self.snapshot.worst_one_second_frames = None;
            self.next_due = None;
            self.last = None;
            self.overload = None;
            self.recovery = None;
            self.samples.clear();
            self.intervals.clear();
            self.snapshot.present_interval_p50_ms = None;
            self.snapshot.present_interval_p99_ms = None;
            self.snapshot.present_interval_p95_ms = None;
            self.snapshot.cpu_p50_ms = None;
            self.snapshot.cpu_p95_ms = None;
            self.snapshot.cpu_p99_ms = None;
        }
        self.snapshot.visible = visible;
    }
    pub fn admit(&mut self, now: f64) -> bool {
        // The 30Hz phase may alternate display-refresh slots. Both modes keep
        // the absolute 60Hz spacing ceiling with 0.5ms timestamp jitter.
        if !self.snapshot.visible
            || self.next_due.is_some_and(|due| now + 1e-9 < due)
            || self
                .last
                .is_some_and(|last| now - last + 1e-9 < 1. / 60. - 0.0005)
        {
            self.snapshot.skipped_frames += 1;
            return false;
        }
        let interval = 1. / self.snapshot.target_fps as f64;
        let due = self.next_due.unwrap_or(now);
        self.next_due = Some(if now - due >= interval * 2. {
            now + interval
        } else {
            due + interval
        });
        if let Some(last) = self.last {
            self.intervals.push_back((now - last) * 1000.);
            if self.intervals.len() > 120 {
                self.intervals.pop_front();
            }
            let mut sorted: Vec<_> = self.intervals.iter().copied().collect();
            sorted.sort_by(f64::total_cmp);
            self.snapshot.present_interval_p50_ms =
                Some(sorted[(sorted.len() * 50).div_ceil(100).saturating_sub(1)]);
            self.snapshot.present_interval_p99_ms =
                Some(sorted[(sorted.len() * 99).div_ceil(100).saturating_sub(1)]);
            self.snapshot.present_interval_p95_ms =
                Some(sorted[(sorted.len() * 95).div_ceil(100).saturating_sub(1)]);
        }
        let start = *self.window_start.get_or_insert(now);
        self.timestamps.push_back(now);
        if self.timestamps.len() > 120 {
            self.timestamps.pop_front();
        }
        while self.timestamps.front().is_some_and(|t| *t <= now - 1.) {
            self.timestamps.pop_front();
        }
        if now - start >= 1. {
            let count = self.timestamps.len();
            self.snapshot.worst_one_second_frames = Some(
                self.snapshot
                    .worst_one_second_frames
                    .map_or(count, |previous| previous.min(count)),
            );
        }
        self.last = Some(now);
        self.snapshot.rendered_frames += 1;
        true
    }
    pub fn record_cpu(&mut self, now: f64, ms: f64) {
        if !ms.is_finite() || ms < 0. {
            return;
        }
        self.samples.push_back(ms);
        if self.samples.len() > 120 {
            self.samples.pop_front();
        }
        let mut sorted: Vec<_> = self.samples.iter().copied().collect();
        sorted.sort_by(f64::total_cmp);
        let p95 = sorted[(sorted.len() * 95).div_ceil(100).saturating_sub(1)];
        self.snapshot.cpu_p50_ms =
            Some(sorted[(sorted.len() * 50).div_ceil(100).saturating_sub(1)]);
        self.snapshot.cpu_p99_ms =
            Some(sorted[(sorted.len() * 99).div_ceil(100).saturating_sub(1)]);
        self.snapshot.cpu_p95_ms = Some(p95);
        if self.snapshot.target_fps == 60 {
            self.recovery = None;
            if p95 > 12.
                || self
                    .snapshot
                    .present_interval_p95_ms
                    .is_some_and(|ms| ms > 25.)
            {
                let start = *self.overload.get_or_insert(now);
                if now - start >= 2. {
                    self.next_due = self.last.map(|last| last + 1. / 30.);
                    self.snapshot.target_fps = 30;
                    self.snapshot.transition_seconds = Some(now);
                    self.snapshot.transition_reason = Some("sustained_overload".into());
                    self.overload = None;
                }
            } else {
                self.overload = None;
            }
        } else {
            // Overload may change cadence, never resource precision or render quality.
            self.overload = None;
            // Pending count is not elapsed work: bounded trajectory jobs may remain
            // queued throughout accelerated playback. Only measured cost gates recovery.
            if p95 < 8. {
                let start = *self.recovery.get_or_insert(now);
                if now - start >= 10. {
                    self.intervals.clear();
                    self.snapshot.present_interval_p50_ms = None;
                    self.snapshot.present_interval_p99_ms = None;
                    self.snapshot.present_interval_p95_ms = None;
                    self.next_due = self.last.map(|last| last + 1. / 60.);
                    self.snapshot.target_fps = 60;
                    self.snapshot.transition_seconds = Some(now);
                    self.snapshot.transition_reason = Some("cpu_recovered".into());
                    self.recovery = None;
                }
            } else {
                self.recovery = None;
            }
        }
    }
}
pub type SharedFrameBudget = Arc<Mutex<FrameBudget>>;
#[derive(Resource)]
struct Admission(bool);
#[derive(Resource)]
struct MainStart(Instant);
#[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
struct BudgetRender;
#[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
struct BudgetMain;
/// Admit the entire main/extract/render cycle together. In particular, message
/// maintenance must not advance while renderer asset extraction is paused.
pub(crate) fn install(app: &mut App, shared: SharedFrameBudget) {
    let clock = Instant::now();
    let main_original = app.main().update_schedule.expect("main schedule");
    let main_budget = shared.clone();
    app.insert_resource(MainStart(Instant::now()));
    app.insert_resource(Admission(false));
    app.add_systems(BudgetMain, move |world: &mut World| {
        let admitted = main_budget
            .lock()
            .map(|mut b| b.admit(clock.elapsed().as_secs_f64()))
            .unwrap_or(false);
        world.resource_mut::<Admission>().0 = admitted;
        if admitted {
            world.resource_mut::<MainStart>().0 = Instant::now();
            let _stage = world
                .get_resource::<crate::render_timings::RenderTimings>()
                .map(|t| t.scope(crate::render_timings::Stage::Main));
            world.run_schedule(main_original);
        }
    });
    app.main_mut().update_schedule = Some(BudgetMain.intern());
    let render = app.sub_app_mut(bevy::render::RenderApp);
    let original: InternedScheduleLabel = render.update_schedule.expect("render schedule");
    let mut extract = render.take_extract();
    let clock = Instant::now();
    render.insert_resource(Admission(false));
    render.set_extract(move |main, render| {
        resync_window_lifecycle(main, render);
        let admitted = main.resource::<Admission>().0;
        render.resource_mut::<Admission>().0 = admitted;
        if admitted {
            let start = main.resource::<MainStart>().0;
            if let Some(extract) = extract.as_mut() {
                let _stage = main
                    .get_resource::<crate::render_timings::RenderTimings>()
                    .map(|t| t.scope(crate::render_timings::Stage::Extract));
                extract(main, render);
            }
            render.insert_resource(CpuSample {
                start,
                shared: shared.clone(),
                clock,
            });
        }
    });
    render.add_systems(BudgetRender, move |world: &mut World| {
        if !world.resource::<Admission>().0 {
            return;
        }
        let stage = world
            .get_resource::<crate::render_timings::RenderTimings>()
            .map(|t| t.scope(crate::render_timings::Stage::Render));
        world.run_schedule(original);
        drop(stage);
        if let (Some(timings), Some(cache)) = (
            world.get_resource::<crate::render_timings::RenderTimings>(),
            world.get_resource::<bevy::render::render_resource::PipelineCache>(),
        ) {
            use bevy::render::render_resource::CachedPipelineState;
            let (mut total, mut pending, mut failed) = (0, 0, 0);
            for pipeline in cache.pipelines() {
                // WebGL display readiness must not wait on unused compute
                // pipelines (the backend does not support compute shaders).
                if !matches!(
                    &pipeline.descriptor,
                    bevy::render::render_resource::PipelineDescriptor::RenderPipelineDescriptor(_)
                ) {
                    continue;
                }
                total += 1;
                match &pipeline.state {
                    CachedPipelineState::Queued | CachedPipelineState::Creating(_) => pending += 1,
                    CachedPipelineState::Err(
                        bevy::shader::ShaderCacheError::ShaderNotLoaded(_)
                        | bevy::shader::ShaderCacheError::ShaderImportNotYetAvailable,
                    ) => pending += 1,
                    CachedPipelineState::Err(_) => failed += 1,
                    CachedPipelineState::Ok(_) => {}
                }
            }
            timings.record_startup(total, pending, failed);
        }
        if let Some(sample) = world.remove_resource::<CpuSample>()
            && let Ok(mut budget) = sample.shared.lock()
        {
            budget.record_cpu(
                sample.clock.elapsed().as_secs_f64(),
                sample.start.elapsed().as_secs_f64() * 1000.,
            );
        }
    });
    render.update_schedule = Some(BudgetRender.intern());
}
#[derive(Resource)]
struct CpuSample {
    start: Instant,
    shared: SharedFrameBudget,
    clock: Instant,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_budget_sustained_overload_keeps_full_resolution() {
        let mut budget = FrameBudget::default();
        for i in 0..=3600 {
            budget.record_cpu(i as f64 / 30., 60.);
            assert_eq!(
                budget.snapshot().resolution_scale,
                1.,
                "overload must not reduce visual fidelity"
            );
        }
        assert_eq!(budget.snapshot().target_fps, 30);
    }

    #[test]
    fn bounded_background_work_does_not_lock_recovered_renderer_at_thirty() {
        let mut budget = FrameBudget::default();
        budget.snapshot.target_fps = 30;
        budget.set_noncritical_pending(4);
        for i in 0..=330 {
            budget.record_cpu(i as f64 / 30., 5.7);
        }
        assert_eq!(budget.snapshot().target_fps, 60);
        assert_eq!(budget.snapshot().noncritical_pending, 4);
        assert_eq!(budget.snapshot().resolution_scale, 1.);
    }

    #[test]
    fn frame_budget_thirty_stays_full_quality_until_cpu_recovery() {
        let mut budget = FrameBudget::default();
        budget.snapshot.target_fps = 30;
        for i in 0..=2400 {
            budget.record_cpu(i as f64 / 30., 13.);
            assert_eq!(budget.snapshot().resolution_scale, 1.);
            assert_eq!(budget.snapshot().target_fps, 30);
        }
    }
    #[test]
    fn frame_budget_30hz_quantizes_on_144hz_without_losing_rate() {
        let mut b = FrameBudget::default();
        b.snapshot.target_fps = 30;
        let mut frames = 0;
        let mut last = None;
        let mut intervals = Vec::new();
        for i in 0..1440 {
            let now = i as f64 / 144.;
            if b.admit(now) {
                frames += 1;
                if let Some(previous) = last {
                    assert!(now - previous >= 1. / 60. - 0.0005);
                    intervals.push((now - previous) * 1000.);
                }
                last = Some(now);
            }
            assert!(frames as f64 <= (now * 30. + 1e-7).floor() + 1.);
        }
        assert!(frames >= 295);
        intervals.sort_by(f64::total_cmp);
        assert!(intervals[(intervals.len() * 95).div_ceil(100) - 1] <= 40.);
    }
    #[test]
    fn frame_budget_telemetry_percentiles_and_stalled_second() {
        let mut b = FrameBudget::default();
        for i in 1..=100 {
            b.record_cpu(i as f64 / 100., i as f64);
        }
        let snapshot = b.snapshot();
        assert_eq!(
            (
                snapshot.cpu_p50_ms,
                snapshot.cpu_p95_ms,
                snapshot.cpu_p99_ms
            ),
            (Some(50.), Some(95.), Some(99.))
        );
        assert!(b.admit(0.));
        assert!(b.admit(2.));
        assert_eq!(b.snapshot().worst_one_second_frames, Some(1));
        assert_eq!(b.snapshot().present_interval_p99_ms, Some(2000.));
        b.set_visible(false);
        assert_eq!(b.snapshot().present_interval_p99_ms, None);
    }
    #[test]
    fn frame_budget_late_frame_cannot_burst() {
        let mut b = FrameBudget::default();
        assert!(b.admit(0.));
        assert!(b.admit(0.032));
        assert!(!b.admit(0.03334));
        assert!(b.admit(0.05));
    }
    #[test]
    fn frame_budget_window_lifecycle_reconciles_after_removal_trackers_expire() {
        use bevy::render::view::window::ExtractedWindows;
        let mut main = World::new();
        let id = main.spawn(Window::default()).id();
        let mut render = World::new();
        let mut windows = ExtractedWindows::default();
        windows.primary = Some(id);
        render.insert_resource(windows);
        main.entity_mut(id).remove::<Window>();
        for _ in 0..100 {
            main.clear_trackers();
        }
        resync_window_lifecycle(&mut main, &mut render);
        assert_eq!(render.resource::<ExtractedWindows>().primary, None);
    }
    #[test]
    fn frame_budget_phase_jitter_keeps_cadence_and_no_burst_after_gap() {
        let mut b = FrameBudget::default();
        let mut frames = 0;
        for i in 0..600 {
            let now = i as f64 / 60. - if i % 2 == 1 { 0.0001 } else { 0. };
            if b.admit(now) {
                frames += 1;
            }
            assert!(frames as f64 <= (now * 60.).floor() + 1.);
        }
        assert!(frames >= 598);
        assert!(b.admit(20.));
        assert!(!b.admit(20.));
    }
    #[test]
    fn frame_budget_preserves_pending_asset_messages_while_skipped() {
        #[derive(Message)]
        struct Loaded;
        #[derive(Resource, Default)]
        struct Received(usize);
        #[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
        struct Original;
        let mut app = App::new();
        app.add_message::<Loaded>();
        let mut render = bevy::app::SubApp::new();
        render.init_resource::<Received>();
        render.init_schedule(Original);
        render.update_schedule = Some(Original.intern());
        render.set_extract(|main, render| {
            let count = main.resource_mut::<Messages<Loaded>>().drain().count();
            render.resource_mut::<Received>().0 += count;
        });
        app.insert_sub_app(bevy::render::RenderApp, render);
        let budget = SharedFrameBudget::default();
        install(&mut app, budget.clone());
        app.update();
        budget.lock().unwrap().set_visible(false);
        app.world_mut().write_message(Loaded);
        for _ in 0..100 {
            app.update();
        }
        budget.lock().unwrap().set_visible(true);
        app.update();
        assert_eq!(
            app.sub_app(bevy::render::RenderApp)
                .world()
                .resource::<Received>()
                .0,
            1
        );
    }
    #[test]
    fn frame_budget_gates_real_subapp_extraction_and_schedule() {
        #[derive(Resource, Default)]
        struct Counts(u32, u32);
        #[derive(ScheduleLabel, Clone, Debug, PartialEq, Eq, Hash)]
        struct Original;
        let mut app = App::new();
        let mut render = bevy::app::SubApp::new();
        render.init_resource::<Counts>();
        render.add_systems(Original, |mut counts: ResMut<Counts>| counts.1 += 1);
        render.update_schedule = Some(Original.intern());
        render.set_extract(|_, render| render.resource_mut::<Counts>().0 += 1);
        app.insert_sub_app(bevy::render::RenderApp, render);
        let budget = SharedFrameBudget::default();
        install(&mut app, budget.clone());
        app.update();
        budget.lock().unwrap().set_visible(false);
        for _ in 0..100 {
            app.update();
        }
        let counts = app
            .sub_app(bevy::render::RenderApp)
            .world()
            .resource::<Counts>();
        assert_eq!((counts.0, counts.1), (1, 1));
        budget.lock().unwrap().set_visible(true);
        app.update();
        let counts = app
            .sub_app(bevy::render::RenderApp)
            .world()
            .resource::<Counts>();
        assert_eq!((counts.0, counts.1), (2, 2));
    }
    #[test]
    fn frame_budget_event_flood_and_visibility() {
        let mut b = FrameBudget::default();
        for tick in 0..1000 {
            b.admit(tick as f64 / 1000.);
        }
        assert!(b.snapshot().rendered_frames <= 60);
        b.set_visible(false);
        assert!(!b.admit(100.));
        b.set_visible(true);
        assert!(b.admit(100.));
        assert!(!b.admit(100.));
    }
    #[test]
    fn frame_budget_hysteresis() {
        let mut b = FrameBudget::default();
        for i in 0..=120 {
            b.record_cpu(i as f64 / 60., 20.);
        }
        assert_eq!(b.snapshot().target_fps, 30);
        for i in 0..2000 {
            b.record_cpu(3. + i as f64 / 30., 7.);
        }
        assert_eq!(b.snapshot().target_fps, 60);
        assert!(b.samples.len() <= 120);
    }
}
fn resync_window_lifecycle(main: &mut World, render: &mut World) {
    use bevy::render::view::window::{ExtractedWindows, WindowSurfaces};
    let live: std::collections::HashSet<Entity> = main
        .query_filtered::<Entity, (With<Window>, With<bevy::window::RawHandleWrapper>)>()
        .iter(main)
        .collect();
    let Some(mut windows) = render.get_resource_mut::<ExtractedWindows>() else {
        return;
    };
    let before = windows.len();
    windows.retain(|id, _| live.contains(id));
    let removed = before != windows.len();
    if windows.primary.is_some_and(|id| !live.contains(&id)) {
        windows.primary = None;
    }
    if removed {
        // The supported browser renderer has one window. The per-surface removal
        // API is private; resetting this public resource releases orphaned surfaces.
        render.insert_resource(WindowSurfaces::default());
    }
}
