// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Scientific time scales for the Rust core.
//!
//! The simulation clock keeps an explicit `TimeInstant` (scale + epoch + integer
//! seconds); this crate owns the conversions that must not live in the host:
//! proleptic Gregorian calendar, UTC/TAI leap seconds, TT and a documented TDB
//! approximation. All instants are exact integer nanoseconds relative to the
//! J2000 event (2000-01-01T12:00:00 TT), so no conversion loses precision and no
//! function reads a system clock.
//!
//! UTC is only defined here for 1972-01-01..=2100-12-31 because the leap-second
//! table starts in 1972 and later values are predictions. Pre-1972 UTC is
//! rejected explicitly instead of being silently approximated.
use spaceeyes_time::TimeInstant;
use std::fmt;

mod calendar;
mod leap;
mod scales;

pub use calendar::{days_from_civil, days_in_month, is_leap_year};
pub use leap::is_predicted_day;

/// First UTC year supported by the leap-second table.
pub const UTC_MIN_YEAR: i32 = 1972;
/// Last UTC year supported by this build (predictions beyond the table).
pub const UTC_MAX_YEAR: i32 = 2100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeError {
    /// Month, day, hour, minute, second or nanosecond is outside its range.
    InvalidCalendar,
    /// UTC outside 1972-01-01..=2100-12-31.
    UtcOutOfRange,
    /// Second 60 is only valid on an inserted leap second at 23:59.
    LeapSecondNotApplicable,
    /// The instant would not fit the `i64` seconds transport.
    Overflow,
    /// A `TimeInstant` uses another scale or epoch.
    UnsupportedScale,
    /// ISO-8601 text is malformed or not UTC (`Z`).
    InvalidIso8601,
}

impl fmt::Display for TimeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::InvalidCalendar => "invalid calendar fields",
            Self::UtcOutOfRange => "UTC outside the supported leap-second range",
            Self::LeapSecondNotApplicable => "leap second is not inserted at this instant",
            Self::Overflow => "time instant overflow",
            Self::UnsupportedScale => "unsupported time scale or epoch",
            Self::InvalidIso8601 => "invalid UTC ISO-8601 instant",
        };
        f.write_str(text)
    }
}

impl std::error::Error for TimeError {}

/// A validated UTC civil date-time. `second` may be 60 only on a leap day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct UtcDateTime {
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    nanos: u32,
}

impl UtcDateTime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        year: i32,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
        nanos: u32,
    ) -> Result<Self, TimeError> {
        if !(1..=12).contains(&month)
            || day == 0
            || day > days_in_month(year, month)
            || hour > 23
            || minute > 59
            || second > 60
            || nanos >= 1_000_000_000
        {
            return Err(TimeError::InvalidCalendar);
        }
        if !(UTC_MIN_YEAR..=UTC_MAX_YEAR).contains(&year) {
            return Err(TimeError::UtcOutOfRange);
        }
        if second == 60 {
            let day_number = days_from_civil(year, month, day);
            if hour != 23 || minute != 59 || !leap::is_leap_day(day_number) {
                return Err(TimeError::LeapSecondNotApplicable);
            }
        }
        let day_number = days_from_civil(year, month, day);
        if !leap::is_utc_day(day_number) {
            return Err(TimeError::UtcOutOfRange);
        }
        Ok(Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
            nanos,
        })
    }

    /// Strict `YYYY-MM-DDTHH:MM:SS[.fraction]Z` parser (1..=9 fraction digits).
    pub fn from_iso8601(text: &str) -> Result<Self, TimeError> {
        let bytes = text.as_bytes();
        if bytes.len() < 20
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || bytes[10] != b'T'
            || bytes[13] != b':'
            || bytes[16] != b':'
            || *bytes.last().ok_or(TimeError::InvalidIso8601)? != b'Z'
        {
            return Err(TimeError::InvalidIso8601);
        }
        let number = |start: usize, len: usize| -> Result<u32, TimeError> {
            let slice = text
                .get(start..start + len)
                .ok_or(TimeError::InvalidIso8601)?;
            if !slice.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(TimeError::InvalidIso8601);
            }
            slice.parse().map_err(|_| TimeError::InvalidIso8601)
        };
        let year = number(0, 4)? as i32;
        let month = number(5, 2)? as u8;
        let day = number(8, 2)? as u8;
        let hour = number(11, 2)? as u8;
        let minute = number(14, 2)? as u8;
        let second = number(17, 2)? as u8;
        let mut nanos = 0_u32;
        if bytes.len() > 20 {
            if bytes[19] != b'.' {
                return Err(TimeError::InvalidIso8601);
            }
            let digits = bytes.len() - 21;
            if !(1..=9).contains(&digits) {
                return Err(TimeError::InvalidIso8601);
            }
            let fraction = number(20, digits)?;
            nanos = fraction * 10_u32.pow(9 - digits as u32);
        }
        Self::new(year, month, day, hour, minute, second, nanos)
    }

    pub fn to_iso8601(&self) -> String {
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:09}Z",
            self.year, self.month, self.day, self.hour, self.minute, self.second, self.nanos
        )
    }

    pub fn year(&self) -> i32 {
        self.year
    }
    pub fn month(&self) -> u8 {
        self.month
    }
    pub fn day(&self) -> u8 {
        self.day
    }
    pub fn hour(&self) -> u8 {
        self.hour
    }
    pub fn minute(&self) -> u8 {
        self.minute
    }
    pub fn second(&self) -> u8 {
        self.second
    }
    pub fn nanos(&self) -> u32 {
        self.nanos
    }
}

macro_rules! instant_type {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
        pub struct $name {
            nanos: i128,
        }
        impl $name {
            pub fn nanos_since_j2000(self) -> i128 {
                self.nanos
            }
            /// Seconds since J2000 for data formats; the exact integer API stays authoritative.
            pub fn seconds_f64(self) -> f64 {
                self.nanos as f64 / 1_000_000_000.0
            }
        }
    };
}

instant_type!(TaiInstant);
instant_type!(TtInstant);
instant_type!(TdbInstant);

fn split(nanos: i128) -> Result<(i64, u32), TimeError> {
    let seconds =
        i64::try_from(nanos.div_euclid(1_000_000_000)).map_err(|_| TimeError::Overflow)?;
    Ok((seconds, nanos.rem_euclid(1_000_000_000) as u32))
}

fn from_instant(instant: &TimeInstant, scale: &str) -> Result<i128, TimeError> {
    if instant.scale() != scale || instant.epoch() != "J2000" {
        return Err(TimeError::UnsupportedScale);
    }
    i128::from(instant.seconds())
        .checked_mul(1_000_000_000)
        .and_then(|value| value.checked_add(i128::from(instant.nanos())))
        .ok_or(TimeError::Overflow)
}

macro_rules! time_instant_conversion {
    ($name:ident, $scale:literal) => {
        impl $name {
            /// Explicit `TimeInstant` for protocol transport; never a default scale.
            pub fn to_time_instant(self) -> Result<TimeInstant, TimeError> {
                let (seconds, nanos) = split(self.nanos)?;
                TimeInstant::new($scale, "J2000", seconds, nanos).ok_or(TimeError::Overflow)
            }
            pub fn from_time_instant(instant: &TimeInstant) -> Result<Self, TimeError> {
                Ok(Self {
                    nanos: from_instant(instant, $scale)?,
                })
            }
        }
    };
}

time_instant_conversion!(TaiInstant, "TAI");
time_instant_conversion!(TtInstant, "TT");
time_instant_conversion!(TdbInstant, "TDB");

pub fn utc_to_tai(utc: &UtcDateTime) -> Result<TaiInstant, TimeError> {
    Ok(TaiInstant {
        nanos: scales::utc_to_tai_nanos(utc)?,
    })
}

pub fn tai_to_utc(tai: TaiInstant) -> Result<UtcDateTime, TimeError> {
    scales::tai_nanos_to_utc(tai.nanos)
}

pub fn tai_to_tt(tai: TaiInstant) -> TtInstant {
    // Both scales tick at the same rate and share the J2000 event as zero, so the
    // constant 32.184 s offset is absorbed by the epoch definition.
    TtInstant { nanos: tai.nanos }
}

pub fn tt_to_tai(tt: TtInstant) -> Result<TaiInstant, TimeError> {
    Ok(TaiInstant { nanos: tt.nanos })
}

/// TT - UTC at the given UTC day, i.e. (TAI - UTC) + 32.184 s.
pub fn tt_minus_utc_nanos(utc: &UtcDateTime) -> Result<i128, TimeError> {
    scales::tt_minus_utc_nanos(utc)
}

pub fn tt_to_tdb(tt: TtInstant) -> TdbInstant {
    TdbInstant {
        nanos: tt.nanos + scales::tdb_minus_tt_nanos(tt.nanos),
    }
}

/// Invert the two-term TDB approximation by fixed-point iteration (1 ns target).
pub fn tdb_to_tt(tdb: TdbInstant) -> Result<TtInstant, TimeError> {
    let mut tt = tdb.nanos;
    for _ in 0..8 {
        let next = tdb
            .nanos
            .checked_sub(scales::tdb_minus_tt_nanos(tt))
            .ok_or(TimeError::Overflow)?;
        if next == tt {
            break;
        }
        tt = next;
    }
    Ok(TtInstant { nanos: tt })
}

pub fn utc_to_tt(utc: &UtcDateTime) -> Result<TtInstant, TimeError> {
    Ok(tai_to_tt(utc_to_tai(utc)?))
}

pub fn tt_to_utc(tt: TtInstant) -> Result<UtcDateTime, TimeError> {
    tai_to_utc(tt_to_tai(tt)?)
}

pub fn utc_to_tdb(utc: &UtcDateTime) -> Result<TdbInstant, TimeError> {
    Ok(tt_to_tdb(utc_to_tt(utc)?))
}

pub fn tdb_to_utc(tdb: TdbInstant) -> Result<UtcDateTime, TimeError> {
    tt_to_utc(tdb_to_tt(tdb)?)
}

/// True when the UTC date lies beyond the published leap-second table of this build.
pub fn is_predicted_utc(utc: &UtcDateTime) -> bool {
    is_predicted_day(days_from_civil(utc.year, utc.month, utc.day))
}
