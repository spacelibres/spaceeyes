//! Calendar projection stays in Hifitime; the scientific clock remains TDB.
use crate::CoreError;
use hifitime::Epoch;

/// Project TDB to Unix seconds, correcting Hifitime 4.3.1's inverse near leap
/// boundaries against its forward conversion. Unix has no `23:59:60`: for an
/// instant without a Unix preimage, retain Hifitime's existing folded result.
pub fn tdb_to_utc_unix(tdb: f64) -> Result<f64, CoreError> {
    if !tdb.is_finite() || tdb.abs() > 1e12 {
        return Err(CoreError::InvalidTime);
    }
    let folded = Epoch::from_tdb_seconds(tdb).to_unix_seconds();
    let mut unix = folded;
    for _ in 0..3 {
        let residual = tdb - Epoch::from_unix_seconds(unix).to_tdb_seconds();
        if residual.abs() <= 1e-6 {
            return Ok(unix);
        }
        unix += residual;
        if !unix.is_finite() {
            break;
        }
    }
    Ok(folded)
}
