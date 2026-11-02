//! Source UI conformance bounds; this does not certify DYN's physical time scale.
use hifitime::Epoch;

#[test]
fn recovered_eyes_ui_et_is_tt_like_with_documented_tdb_residual() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../validation/eyes-time-reference.json")).unwrap();
    for row in fixture["rows"].as_array().unwrap() {
        let unix = row["unixSeconds"].as_f64().unwrap();
        let eyes_et = row["eyesEtSeconds"].as_f64().unwrap();
        let eyes_ms = row["eyesEtMilliseconds"].as_f64().unwrap();
        let epoch = Epoch::from_unix_seconds(unix);
        let tt = epoch.to_tt_since_j2k().to_seconds();
        assert!((tt - eyes_et).abs() <= 1e-6, "TT reference: {row}");
        let tdb = epoch.to_tdb_seconds();
        assert!((tdb - eyes_ms).abs() <= 0.0022, "UI/TDB bound: {row}");
        let roundtrip = spaceeyes_core::time_conversion::tdb_to_utc_unix(tdb).unwrap();
        assert!(
            (roundtrip - unix).abs() <= 1e-6,
            "UTC roundtrip {roundtrip} vs {unix}, diff {}: {row}",
            roundtrip - unix
        );
    }
}

#[test]
fn ordinary_unix_roundtrips_across_leap_boundaries_and_true_leaps_remain_finite() {
    for midnight in [
        1136073600.,
        1230768000.,
        1341100800.,
        1435708800.,
        1483228800.,
    ] {
        for offset in [-2., -1., -0.75, -0.5, -0.25, 0., 0.25, 1., 2.] {
            let unix = midnight + offset;
            let tdb = Epoch::from_unix_seconds(unix).to_tdb_seconds();
            let result = spaceeyes_core::time_conversion::tdb_to_utc_unix(tdb).unwrap();
            assert!((result - unix).abs() <= 1e-6, "{unix}: {result}");
        }
    }
    let leap = Epoch::from_gregorian_utc(2016, 12, 31, 23, 59, 60, 500_000_000).to_tdb_seconds();
    let folded = Epoch::from_tdb_seconds(leap).to_unix_seconds();
    let result = spaceeyes_core::time_conversion::tdb_to_utc_unix(leap).unwrap();
    assert!(result.is_finite());
    if (Epoch::from_unix_seconds(result).to_tdb_seconds() - leap).abs() > 1e-6 {
        assert_eq!(result, folded);
    }
    for invalid in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        1e12 + 1.,
        -1e12 - 1.,
    ] {
        assert!(spaceeyes_core::time_conversion::tdb_to_utc_unix(invalid).is_err());
    }
}
