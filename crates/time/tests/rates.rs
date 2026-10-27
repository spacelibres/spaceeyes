use spaceeyes_time::{FixedStepper, PlaybackRate, SimulationClock, TimeInstant};
fn clock() -> SimulationClock {
    SimulationClock::new(TimeInstant::new("TT", "explicit", 0, 0).unwrap())
}
#[test]
fn fractional_forward_and_reverse_are_partition_invariant() {
    for numerator in [1, -1, 2, -2, 0] {
        let mut c = clock();
        c.set_rate(PlaybackRate::new(numerator, 3).unwrap())
            .unwrap();
        c.play().unwrap();
        let mut single = c.clone();
        single.advance_nanos(999).unwrap();
        for _ in 0..999 {
            c.advance_nanos(1).unwrap();
        }
        assert_eq!(c.instant(), single.instant());
        assert_eq!(c.generation(), single.generation());
        c.pause().unwrap();
        let snapshot = c.snapshot();
        c.advance_nanos(u64::MAX).unwrap();
        assert_eq!(snapshot, c.snapshot());
    }
}
#[test]
fn rate_changes_seek_and_steps_clear_fractional_remainder() {
    let mut c = clock();
    c.set_rate(PlaybackRate::new(1, 3).unwrap()).unwrap();
    c.play().unwrap();
    c.advance_nanos(2).unwrap();
    c.seek(TimeInstant::new("TT", "explicit", 0, 0).unwrap())
        .unwrap();
    c.advance_nanos(1).unwrap();
    assert_eq!(c.instant().nanos(), 0);
    c.set_rate(PlaybackRate::new(1, 2).unwrap()).unwrap();
    c.advance_nanos(1).unwrap();
    assert_eq!(c.instant().nanos(), 0);
    c.step_nanos(1).unwrap();
    c.advance_nanos(1).unwrap();
    assert_eq!(c.instant().nanos(), 1);
    assert!(PlaybackRate::new(1, 0).is_err());
    assert!(PlaybackRate::new(i32::MIN, 1).is_err());
}
#[test]
fn fixed_stepper_bounds_catchup_and_preserves_backlog() {
    let mut s = FixedStepper::new(10, 3).unwrap();
    let a = s.accumulate(105).unwrap();
    assert_eq!(a.steps, 3);
    assert_eq!(a.backlog_nanos, 75);
    let b = s.accumulate(0).unwrap();
    assert_eq!(b.steps, 3);
    assert_eq!(b.backlog_nanos, 45);
    assert!(FixedStepper::new(0, 1).is_err());
    assert!(FixedStepper::new(1, 0).is_err());
}
