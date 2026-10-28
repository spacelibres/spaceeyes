// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Scientific scale acceptance: known epochs, leap seconds, round trips, bounds.
use spaceeyes_astro::{
    is_predicted_utc, tai_to_tt, tai_to_utc, tdb_to_tt, tdb_to_utc, tt_minus_utc_nanos, tt_to_tai,
    tt_to_tdb, tt_to_utc, utc_to_tai, utc_to_tdb, utc_to_tt, TaiInstant, TdbInstant, TimeError,
    TtInstant, UtcDateTime,
};
use spaceeyes_time::TimeInstant;

fn utc(year: i32, month: u8, day: u8, hour: u8, minute: u8, second: u8, nanos: u32) -> UtcDateTime {
    UtcDateTime::new(year, month, day, hour, minute, second, nanos).unwrap()
}

#[test]
fn j2000_is_the_tt_origin() {
    let j2000 = utc(2000, 1, 1, 11, 58, 55, 816_000_000);
    assert_eq!(utc_to_tt(&j2000).unwrap().nanos_since_j2000(), 0);
    let tdb = utc_to_tdb(&j2000).unwrap();
    // The two-term TDB model puts J2000 about 72.6 us before TT, not exactly zero.
    assert!((-100_000..0).contains(&tdb.nanos_since_j2000()));
    assert_eq!(tdb_to_utc(tdb).unwrap(), j2000);
}

#[test]
fn inserted_leap_second_is_exact() {
    let before = utc_to_tai(&utc(2016, 12, 31, 23, 59, 59, 0)).unwrap();
    let leap = utc_to_tai(&utc(2016, 12, 31, 23, 59, 60, 0)).unwrap();
    let after = utc_to_tai(&utc(2017, 1, 1, 0, 0, 0, 0)).unwrap();
    assert_eq!(
        leap.nanos_since_j2000() - before.nanos_since_j2000(),
        1_000_000_000
    );
    assert_eq!(
        after.nanos_since_j2000() - leap.nanos_since_j2000(),
        1_000_000_000
    );

    let day_start = utc_to_tai(&utc(2016, 12, 31, 0, 0, 0, 0)).unwrap();
    let next_day = utc_to_tai(&utc(2017, 1, 1, 0, 0, 0, 0)).unwrap();
    assert_eq!(
        next_day.nanos_since_j2000() - day_start.nanos_since_j2000(),
        86_401_000_000_000
    );
}

#[test]
fn no_leap_second_on_normal_days() {
    assert_eq!(
        utc_to_tai(&utc(2017, 1, 2, 0, 0, 0, 0))
            .unwrap()
            .nanos_since_j2000()
            - utc_to_tai(&utc(2017, 1, 1, 0, 0, 0, 0))
                .unwrap()
                .nanos_since_j2000(),
        86_400_000_000_000
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 30, 23, 59, 60, 0),
        Err(TimeError::LeapSecondNotApplicable)
    );
    assert_eq!(
        UtcDateTime::new(2017, 1, 1, 23, 59, 60, 0),
        Err(TimeError::LeapSecondNotApplicable)
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 31, 23, 58, 60, 0),
        Err(TimeError::LeapSecondNotApplicable)
    );
}

#[test]
fn round_trips_every_scale() {
    let dates = [
        utc(1972, 1, 1, 0, 0, 0, 0),
        utc(1980, 6, 15, 12, 34, 56, 789_000_000),
        utc(1999, 12, 31, 23, 59, 59, 999_999_999),
        utc(2016, 12, 31, 23, 59, 60, 123_456_789),
        utc(2017, 1, 1, 0, 0, 0, 0),
        utc(2026, 10, 28, 8, 42, 0, 1),
        utc(2050, 12, 31, 23, 59, 59, 0),
        utc(2100, 12, 31, 23, 59, 59, 0),
    ];
    for date in dates {
        let tdb = utc_to_tdb(&date).unwrap();
        assert_eq!(tdb_to_utc(tdb).unwrap(), date);
        assert_eq!(tt_to_utc(tdb_to_tt(tdb).unwrap()).unwrap(), date);
        let tai = utc_to_tai(&date).unwrap();
        assert_eq!(tai_to_utc(tai).unwrap(), date);
    }
}

#[test]
fn tt_to_tdb_inversion_is_sub_nanosecond() {
    for seconds in [-2_000_000_000_i128, -1, 0, 1, 1_000_000_000, 2_000_000_000] {
        let tt = TtInstant::from_time_instant(
            &TimeInstant::new("TT", "J2000", seconds as i64, 123_456_789).unwrap(),
        )
        .unwrap();
        let back = tdb_to_tt(tt_to_tdb(tt)).unwrap();
        assert!((back.nanos_since_j2000() - tt.nanos_since_j2000()).abs() <= 1);
    }
}

#[test]
fn ti_to_tai_and_instant_transport_are_exact() {
    let tai = utc_to_tai(&utc(2026, 10, 28, 8, 42, 0, 7)).unwrap();
    let instant = tai.to_time_instant().unwrap();
    assert_eq!(instant.scale(), "TAI");
    assert_eq!(instant.epoch(), "J2000");
    assert_eq!(TaiInstant::from_time_instant(&instant).unwrap(), tai);

    let tdb = utc_to_tdb(&utc(2026, 10, 28, 8, 42, 0, 7)).unwrap();
    let instant = tdb.to_time_instant().unwrap();
    assert_eq!(instant.scale(), "TDB");
    assert_eq!(TdbInstant::from_time_instant(&instant).unwrap(), tdb);
    assert_eq!(
        TdbInstant::from_time_instant(&TimeInstant::new("TT", "J2000", 0, 0).unwrap()),
        Err(TimeError::UnsupportedScale)
    );
}

#[test]
fn utc_range_is_enforced_on_both_directions() {
    assert_eq!(
        UtcDateTime::new(1971, 12, 31, 23, 59, 59, 0),
        Err(TimeError::UtcOutOfRange)
    );
    assert_eq!(
        UtcDateTime::new(2101, 1, 1, 0, 0, 0, 0),
        Err(TimeError::UtcOutOfRange)
    );
    let first = utc_to_tai(&utc(1972, 1, 1, 0, 0, 0, 0)).unwrap();
    let last = utc_to_tai(&utc(2100, 12, 31, 23, 59, 59, 999_999_999)).unwrap();
    assert_eq!(tai_to_utc(first).unwrap(), utc(1972, 1, 1, 0, 0, 0, 0));
    assert_eq!(
        tai_to_utc(last).unwrap(),
        utc(2100, 12, 31, 23, 59, 59, 999_999_999)
    );
    assert_eq!(
        tai_to_utc(tai_from_nanos(first.nanos_since_j2000() - 1)),
        Err(TimeError::UtcOutOfRange)
    );
    assert_eq!(
        tai_to_utc(tai_from_nanos(last.nanos_since_j2000() + 1)),
        Err(TimeError::UtcOutOfRange)
    );
}

fn tai_from_nanos(nanos: i128) -> TaiInstant {
    let seconds = i64::try_from(nanos.div_euclid(1_000_000_000)).unwrap();
    let sub = nanos.rem_euclid(1_000_000_000) as u32;
    TaiInstant::from_time_instant(&TimeInstant::new("TAI", "J2000", seconds, sub).unwrap()).unwrap()
}

#[test]
fn calendar_fields_are_validated() {
    assert_eq!(
        UtcDateTime::new(2016, 2, 30, 0, 0, 0, 0),
        Err(TimeError::InvalidCalendar)
    );
    assert_eq!(
        UtcDateTime::new(2017, 13, 1, 0, 0, 0, 0),
        Err(TimeError::InvalidCalendar)
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 31, 24, 0, 0, 0),
        Err(TimeError::InvalidCalendar)
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 31, 23, 60, 0, 0),
        Err(TimeError::InvalidCalendar)
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 31, 23, 59, 61, 0),
        Err(TimeError::InvalidCalendar)
    );
    assert_eq!(
        UtcDateTime::new(2016, 12, 31, 23, 59, 59, 1_000_000_000),
        Err(TimeError::InvalidCalendar)
    );
    assert!(UtcDateTime::new(2000, 2, 29, 0, 0, 0, 0).is_ok());
    assert_eq!(
        UtcDateTime::new(2100, 2, 29, 0, 0, 0, 0),
        Err(TimeError::InvalidCalendar)
    );
}

#[test]
fn iso8601_round_trip_and_leap_second_text() {
    let parsed = UtcDateTime::from_iso8601("2000-01-01T11:58:55.816Z").unwrap();
    assert_eq!(parsed, utc(2000, 1, 1, 11, 58, 55, 816_000_000));
    assert_eq!(parsed.to_iso8601(), "2000-01-01T11:58:55.816000000Z");
    assert_eq!(
        UtcDateTime::from_iso8601("2016-12-31T23:59:60Z").unwrap(),
        utc(2016, 12, 31, 23, 59, 60, 0)
    );
    for bad in [
        "2000-01-01 11:58:55.816Z",
        "2000-01-01T11:58:55",
        "2000-01-01T11:58:55.1234567890Z",
        "2000-01-01T11:58:55.Z",
        "2000-01-01T11:58:55,5Z",
        "abcd-01-01T00:00:00Z",
    ] {
        assert_eq!(
            UtcDateTime::from_iso8601(bad),
            Err(TimeError::InvalidIso8601),
            "{bad}"
        );
    }
}

#[test]
fn predicted_flag_tracks_the_table() {
    assert!(!is_predicted_utc(&utc(2026, 10, 28, 0, 0, 0, 0)));
    assert!(!is_predicted_utc(&utc(2027, 1, 1, 0, 0, 0, 0)));
    assert!(is_predicted_utc(&utc(2028, 1, 1, 0, 0, 0, 0)));
}

#[test]
fn tt_and_tai_share_the_same_relative_rate() {
    let tai = utc_to_tai(&utc(2026, 10, 28, 0, 0, 0, 0)).unwrap();
    let tt = tai_to_tt(tai);
    assert_eq!(tt.nanos_since_j2000(), tai.nanos_since_j2000());
    assert_eq!(tt_to_tai(tt).unwrap(), tai);
}

#[test]
fn tt_minus_utc_matches_the_leap_table() {
    assert_eq!(
        tt_minus_utc_nanos(&utc(1972, 1, 1, 0, 0, 0, 0)).unwrap(),
        42_184_000_000
    );
    assert_eq!(
        tt_minus_utc_nanos(&utc(2017, 1, 1, 0, 0, 0, 0)).unwrap(),
        69_184_000_000
    );
    assert_eq!(
        tt_minus_utc_nanos(&utc(2026, 10, 28, 0, 0, 0, 0)).unwrap(),
        69_184_000_000
    );
}
