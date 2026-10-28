// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! UTC leap-second table (TAI - UTC) and the 2026 CGPM continuous-UTC decision.
//!
//! The 28th CGPM (15 October 2026) decided that continuous UTC starts on
//! 2027-05-20: no further leap seconds are inserted, and the allowed |UTC-UT1|
//! difference becomes 3600 s (a future "leap hour", not modelled here). The 27
//! historical leap seconds remain part of the table, so TAI-UTC stays 37 s until
//! a leap hour is eventually needed (expected on a multi-millennial scale).
//! Days before the start are observed or predicted as before; they are never
//! silently marked as observed.

use crate::calendar::days_from_civil;
use crate::UtcRegime;

pub const UTC_MIN_DAY: i64 = days_from_civil(1972, 1, 1);
pub const UTC_MAX_DAY: i64 = days_from_civil(2100, 12, 31);
/// Last date covered by a published IERS announcement at the time of this build.
pub const PUBLISHED_THROUGH_DAY: i64 = days_from_civil(2027, 1, 1);
/// Continuous UTC takes effect on 2027-05-20 (World Metrology Day).
pub const UTC_CONTINUOUS_FROM_YEAR: i32 = 2027;
pub const UTC_CONTINUOUS_FROM_MONTH: u8 = 5;
pub const UTC_CONTINUOUS_FROM_DATE: u8 = 20;
pub const UTC_CONTINUOUS_FROM_DAY: i64 = days_from_civil(
    UTC_CONTINUOUS_FROM_YEAR,
    UTC_CONTINUOUS_FROM_MONTH,
    UTC_CONTINUOUS_FROM_DATE,
);
/// Maximum |UTC - UT1| under continuous UTC; a future leap hour, not modelled.
pub const LEAP_HOUR_SECONDS: i64 = 3600;

/// `(UTC effective day at 00:00, TAI - UTC in seconds)`.
const LEAPS: &[(i64, i32)] = &[
    (days_from_civil(1972, 1, 1), 10),
    (days_from_civil(1972, 7, 1), 11),
    (days_from_civil(1973, 1, 1), 12),
    (days_from_civil(1974, 1, 1), 13),
    (days_from_civil(1975, 1, 1), 14),
    (days_from_civil(1976, 1, 1), 15),
    (days_from_civil(1977, 1, 1), 16),
    (days_from_civil(1978, 1, 1), 17),
    (days_from_civil(1979, 1, 1), 18),
    (days_from_civil(1980, 1, 1), 19),
    (days_from_civil(1981, 7, 1), 20),
    (days_from_civil(1982, 7, 1), 21),
    (days_from_civil(1983, 7, 1), 22),
    (days_from_civil(1985, 7, 1), 23),
    (days_from_civil(1988, 1, 1), 24),
    (days_from_civil(1990, 1, 1), 25),
    (days_from_civil(1991, 1, 1), 26),
    (days_from_civil(1992, 7, 1), 27),
    (days_from_civil(1993, 7, 1), 28),
    (days_from_civil(1994, 7, 1), 29),
    (days_from_civil(1996, 1, 1), 30),
    (days_from_civil(1997, 7, 1), 31),
    (days_from_civil(1999, 1, 1), 32),
    (days_from_civil(2006, 1, 1), 33),
    (days_from_civil(2009, 1, 1), 34),
    (days_from_civil(2012, 7, 1), 35),
    (days_from_civil(2015, 7, 1), 36),
    (days_from_civil(2017, 1, 1), 37),
];

/// TAI - UTC seconds at the start of the given UTC day.
pub fn delta_at_day(day: i64) -> Option<i32> {
    if day < UTC_MIN_DAY {
        return None;
    }
    LEAPS
        .iter()
        .rev()
        .find(|(start, _)| *start <= day)
        .map(|(_, delta)| *delta)
}

pub(crate) fn is_utc_day(day: i64) -> bool {
    (UTC_MIN_DAY..=UTC_MAX_DAY).contains(&day)
}

/// True when a leap second is inserted at the end of this UTC day (23:59:60).
/// Continuous UTC starts on 2027-05-20, so no later day can carry second 60.
pub fn is_leap_day(day: i64) -> bool {
    if day >= UTC_CONTINUOUS_FROM_DAY {
        return false;
    }
    match (delta_at_day(day), delta_at_day(day + 1)) {
        (Some(current), Some(next)) => next == current + 1,
        _ => false,
    }
}

/// Observed table, short prediction window, or the post-2027 continuous regime.
pub fn utc_regime_day(day: i64) -> Option<UtcRegime> {
    if !is_utc_day(day) {
        return None;
    }
    Some(if day >= UTC_CONTINUOUS_FROM_DAY {
        UtcRegime::Continuous
    } else if day > PUBLISHED_THROUGH_DAY {
        UtcRegime::Predicted
    } else {
        UtcRegime::Observed
    })
}

/// True only inside the short prediction window before continuous UTC starts.
pub fn is_predicted_day(day: i64) -> bool {
    utc_regime_day(day) == Some(UtcRegime::Predicted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_boundaries() {
        assert_eq!(delta_at_day(days_from_civil(1972, 1, 1)), Some(10));
        assert_eq!(delta_at_day(days_from_civil(1972, 6, 30)), Some(10));
        assert_eq!(delta_at_day(days_from_civil(1972, 7, 1)), Some(11));
        assert_eq!(delta_at_day(days_from_civil(2016, 12, 31)), Some(36));
        assert_eq!(delta_at_day(days_from_civil(2017, 1, 1)), Some(37));
        assert_eq!(delta_at_day(days_from_civil(2100, 12, 31)), Some(37));
        assert_eq!(delta_at_day(days_from_civil(1971, 12, 31)), None);
    }

    #[test]
    fn inserted_leap_days() {
        assert!(is_leap_day(days_from_civil(2016, 12, 31)));
        assert!(is_leap_day(days_from_civil(2015, 6, 30)));
        assert!(!is_leap_day(days_from_civil(2016, 12, 30)));
        assert!(!is_leap_day(days_from_civil(2017, 12, 31)));
    }

    #[test]
    fn continuous_utc_from_2027() {
        assert_eq!(
            utc_regime_day(days_from_civil(2027, 5, 19)),
            Some(UtcRegime::Predicted)
        );
        assert_eq!(
            utc_regime_day(days_from_civil(2027, 5, 20)),
            Some(UtcRegime::Continuous)
        );
        assert_eq!(delta_at_day(UTC_CONTINUOUS_FROM_DAY), Some(37));
        assert!(!is_leap_day(days_from_civil(2027, 6, 30)));
        assert!(!is_leap_day(days_from_civil(2100, 12, 31)));
    }

    #[test]
    fn prediction_flag() {
        assert!(!is_predicted_day(days_from_civil(2026, 10, 28)));
        assert!(is_predicted_day(days_from_civil(2027, 3, 1)));
        assert!(!is_predicted_day(days_from_civil(2027, 5, 20)));
        assert!(!is_predicted_day(days_from_civil(2028, 1, 1)));
    }

    #[test]
    fn utc_range() {
        assert!(is_utc_day(days_from_civil(1972, 1, 1)));
        assert!(!is_utc_day(days_from_civil(1971, 12, 31)));
        assert!(is_utc_day(days_from_civil(2100, 12, 31)));
        assert!(!is_utc_day(days_from_civil(2101, 1, 1)));
    }
}
