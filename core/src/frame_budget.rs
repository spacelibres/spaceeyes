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
            let overloaded = p95 > 25.
                || self
                    .snapshot
                    .present_interval_p95_ms
                    .is_some_and(|ms| ms > 40.);
            if overloaded {
                self.recovery = None;
                let start = *self.overload.get_or_insert(now);
                if now - start >= 2. {
                    self.snapshot.resolution_scale = if self.snapshot.resolution_scale > 0.85 {
                        0.85
                    } else if self.snapshot.resolution_scale > 0.7 {
                        0.7
                    } else {
                        0.5
                    };
                    self.snapshot.transition_reason =
                        Some("sustained_30hz_quality_overload".into());
                    self.snapshot.transition_seconds = Some(now);
                    self.overload = None;
                }
            } else {
                self.overload = None;
            }
            let recovering = if self.snapshot.resolution_scale < 1. {
                p95 < 20.
                    && self
                        .snapshot
                        .present_interval_p95_ms
                        .is_some_and(|ms| ms < 38.)
            } else {
                p95 < 8.
            };
            if recovering && self.snapshot.noncritical_pending <= 2 {
                let start = *self.recovery.get_or_insert(now);
                if now - start >= 10. {
                    if self.snapshot.resolution_scale < 1. {
                        self.snapshot.resolution_scale = if self.snapshot.resolution_scale < 0.7 {
                            0.7
                        } else if self.snapshot.resolution_scale < 0.85 {
                            0.85
                        } else {
                            1.
                        };
                        self.snapshot.transition_seconds = Some(now);
                        self.snapshot.transition_reason = Some("quality_recovered".into());
                        self.recovery = None;
                        return;
                    }
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
                if let Ok(budget) = shared.lock() {
                    apply_resolution_scale(render, budget.snapshot.resolution_scale);
                }
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
    fn frame_budget_thirty_cpu_thirteen_preserves_and_restores_quality() {
        let mut b = FrameBudget::default();
        b.snapshot.target_fps = 30;
        b.snapshot.present_interval_p95_ms = Some(35.);
        for i in 0..=1200 {
            b.record_cpu(i as f64 / 30., 13.);
        }
        assert_eq!(b.snapshot.resolution_scale, 1.);
        assert_eq!(b.snapshot.target_fps, 30);
        b.snapshot.resolution_scale = 0.5;
        for i in 1201..=2400 {
            b.record_cpu(i as f64 / 30., 13.);
        }
        assert_eq!(b.snapshot.resolution_scale, 1.);
        assert_eq!(b.snapshot.target_fps, 30);
    }
    #[test]
    fn frame_budget_degrades_quality_then_recovers_before_sixty() {
        let mut b = FrameBudget::default();
        b.snapshot.target_fps = 30;
        b.snapshot.present_interval_p95_ms = Some(35.);
        for i in 0..=240 {
            b.record_cpu(i as f64 / 30., 30.);
        }
        assert_eq!(b.snapshot.resolution_scale, 0.5);
        assert_eq!(b.snapshot.target_fps, 30);
        for i in 0..450 {
            b.record_cpu(9. + i as f64 / 30., 7.);
        }
        assert_eq!(b.snapshot.resolution_scale, 0.7);
        assert_eq!(b.snapshot.target_fps, 30);
        for i in 450..1600 {
            b.record_cpu(9. + i as f64 / 30., 7.);
        }
        assert_eq!(b.snapshot.resolution_scale, 1.);
        assert_eq!(b.snapshot.target_fps, 60);
    }
    #[test]
    fn frame_budget_resolution_override_preserves_logical_camera_viewport() {
        use bevy::{camera::MainPassResolutionOverride, render::camera::ExtractedCamera};
        let mut world = World::new();
        let id = world
            .spawn(ExtractedCamera {
                physical_viewport_size: Some(UVec2::new(800, 600)),
                target: None,
                physical_target_size: Some(UVec2::new(800, 600)),
                viewport: None,
                schedule: Main.intern(),
                order: 0,
                output_mode: Default::default(),
                msaa_writeback: Default::default(),
                clear_color: Default::default(),
                sorted_camera_index_for_target: 0,
                exposure: 1.,
                hdr: false,
                compositing_space: None,
            })
            .id();
        apply_resolution_scale(&mut world, 0.5);
        assert_eq!(
            world.get::<MainPassResolutionOverride>(id).unwrap().0,
            UVec2::new(400, 300)
        );
        assert_eq!(
            world
                .get::<ExtractedCamera>(id)
                .unwrap()
                .physical_viewport_size,
            Some(UVec2::new(800, 600))
        );
        apply_resolution_scale(&mut world, 1.);
        assert!(world.get::<MainPassResolutionOverride>(id).is_none());
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
fn apply_resolution_scale(render: &mut World, scale: f64) {
    use bevy::{camera::MainPassResolutionOverride, render::camera::ExtractedCamera};
    let cameras: Vec<_> = render
        .query::<(Entity, &ExtractedCamera)>()
        .iter(render)
        .filter_map(|(id, c)| c.physical_viewport_size.map(|size| (id, size)))
        .collect();
    for (id, size) in cameras {
        if scale >= 1. {
            render.entity_mut(id).remove::<MainPassResolutionOverride>();
        } else {
            render
                .entity_mut(id)
                .insert(MainPassResolutionOverride(UVec2::new(
                    ((size.x as f64 * scale).round() as u32).max(1),
                    ((size.y as f64 * scale).round() as u32).max(1),
                )));
        }
    }
}
