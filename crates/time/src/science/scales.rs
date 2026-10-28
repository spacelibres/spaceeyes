// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Scale conversions. Zero is the J2000 event for every scale, so TAI/TT/TDB
//! values are exact integer offsets and only UTC needs the leap-second table.

use super::calendar::{civil_from_days, days_from_civil};
use super::leap::{delta_at_day, is_utc_day, UTC_MAX_DAY, UTC_MIN_DAY};
use super::{TimeError, UtcDateTime};

pub(crate) const NANOS_PER_SECOND: i128 = 1_000_000_000;
const SECONDS_PER_DAY: i128 = 86_400;
/// TAI reading of the J2000 event as absolute TAI since 1970-01-01:
/// 10957 days + 43_167.816 s (2000-01-01T11:59:27.816 TAI = 12:00:00 TT).
const TAI_AT_J2000_NANOS: i128 = 946_727_967_816_000_000;

fn day_start_tai_nanos(day: i64) -> Result<i128, TimeError> {
    let delta = delta_at_day(day).ok_or(TimeError::UtcOutOfRange)?;
    Ok(i128::from(day) * SECONDS_PER_DAY * NANOS_PER_SECOND + i128::from(delta) * NANOS_PER_SECOND)
}

pub(crate) fn utc_to_tai_nanos(utc: &UtcDateTime) -> Result<i128, TimeError> {
    let day = days_from_civil(utc.year(), utc.month(), utc.day());
    if !is_utc_day(day) {
        return Err(TimeError::UtcOutOfRange);
    }
    let delta = delta_at_day(day).ok_or(TimeError::UtcOutOfRange)?;
    let seconds_of_day: i128 = if utc.second() == 60 {
        SECONDS_PER_DAY
    } else {
        i128::from(utc.hour()) * 3600 + i128::from(utc.minute()) * 60 + i128::from(utc.second())
    };
    let absolute = i128::from(day) * SECONDS_PER_DAY * NANOS_PER_SECOND
        + i128::from(delta) * NANOS_PER_SECOND
        + seconds_of_day * NANOS_PER_SECOND
        + i128::from(utc.nanos());
    absolute
        .checked_sub(TAI_AT_J2000_NANOS)
        .ok_or(TimeError::Overflow)
}

/// TT - UTC = (TAI - UTC) + 32.184 s, evaluated at the UTC day.
pub(crate) fn tt_minus_utc_nanos(utc: &UtcDateTime) -> Result<i128, TimeError> {
    let day = days_from_civil(utc.year(), utc.month(), utc.day());
    if !is_utc_day(day) {
        return Err(TimeError::UtcOutOfRange);
    }
    let delta = delta_at_day(day).ok_or(TimeError::UtcOutOfRange)?;
    Ok(i128::from(delta) * NANOS_PER_SECOND + 32_184_000_000)
}

pub(crate) fn tai_nanos_to_utc(nanos: i128) -> Result<UtcDateTime, TimeError> {
    let absolute = nanos
        .checked_add(TAI_AT_J2000_NANOS)
        .ok_or(TimeError::Overflow)?;
    let first = day_start_tai_nanos(UTC_MIN_DAY)?;
    let end = day_start_tai_nanos(UTC_MAX_DAY + 1)?;
    if absolute < first || absolute >= end {
        return Err(TimeError::UtcOutOfRange);
    }
    // Largest UTC day whose TAI start is not after the instant.
    let mut low = UTC_MIN_DAY;
    let mut high = UTC_MAX_DAY + 1;
    while low + 1 < high {
        let middle = low + (high - low) / 2;
        if day_start_tai_nanos(middle)? <= absolute {
            low = middle;
        } else {
            high = middle;
        }
    }
    let offset = absolute - day_start_tai_nanos(low)?;
    let (year, month, day) = civil_from_days(low);
    let (hour, minute, second, sub_nanos) = if offset >= SECONDS_PER_DAY * NANOS_PER_SECOND {
        // The inserted 23:59:60 second is offset 86400 within the leap day.
        let extra = offset - SECONDS_PER_DAY * NANOS_PER_SECOND;
        if extra >= NANOS_PER_SECOND {
            return Err(TimeError::UtcOutOfRange);
        }
        (
            23,
            59,
            60,
            u32::try_from(extra).map_err(|_| TimeError::Overflow)?,
        )
    } else {
        let seconds = offset.div_euclid(NANOS_PER_SECOND);
        let sub =
            u32::try_from(offset.rem_euclid(NANOS_PER_SECOND)).map_err(|_| TimeError::Overflow)?;
        (
            u8::try_from(seconds / 3600).map_err(|_| TimeError::Overflow)?,
            u8::try_from((seconds % 3600) / 60).map_err(|_| TimeError::Overflow)?,
            u8::try_from(seconds % 60).map_err(|_| TimeError::Overflow)?,
            sub,
        )
    };
    UtcDateTime::new(year, month, day, hour, minute, second, sub_nanos)
}

/// Two-term TDB - TT approximation in nanoseconds (USNO-style, ~10 us level).
/// It is a transport/display approximation, documented and tested for bounds;
/// it is not a final scientific model and must not be used to claim precision.
pub(crate) fn tdb_minus_tt_nanos(tt_nanos: i128) -> i128 {
    let days = tt_nanos as f64 / (SECONDS_PER_DAY as f64 * NANOS_PER_SECOND as f64);
    let mean_anomaly = (357.528 + 0.985_600_3 * days).to_radians();
    let seconds = 0.001_657 * mean_anomaly.sin() + 0.000_013_85 * (2.0 * mean_anomaly).sin();
    (seconds * NANOS_PER_SECOND as f64).round() as i128
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tdb_offset_is_bounded() {
        let mut maximum = 0_i128;
        let mut minimum = 0_i128;
        for day in 0..36_525 {
            let nanos = i128::from(day) * SECONDS_PER_DAY * NANOS_PER_SECOND;
            let offset = tdb_minus_tt_nanos(nanos);
            maximum = maximum.max(offset);
            minimum = minimum.min(offset);
        }
        assert!(maximum > 1_500_000 && maximum < 1_800_000, "{maximum}");
        assert!(minimum < -1_500_000 && minimum > -1_800_000, "{minimum}");
    }
}
