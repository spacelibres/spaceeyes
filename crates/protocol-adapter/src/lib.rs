// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Protobuf is the external exchange boundary; domain types remain authoritative.
//! Shared Scene/Time/Resources/Spatial commands and read-only session/frame queries.
mod dispatch;
pub mod limits;
mod presentation;
mod query;
mod uploads;
pub use dispatch::*;
pub use presentation::{decode_host_frame, HostFrameRequest};
pub mod generated {
    include!(concat!(env!("OUT_DIR"), "/spaceeyes.core.v1.rs"));
}
use spaceeyes_foundation::{CoreError, FrameId, ObjectId, ResourceId};
use spaceeyes_time::TimeInstant;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    MissingField,
    UnsupportedTimeScale,
    InvalidTime,
    InvalidIdentifier,
    UnsupportedCommand,
    InvalidContext,
    MessageTooLarge,
    UnsupportedVersion,
}
impl From<CoreError> for ProtocolError {
    fn from(_: CoreError) -> Self {
        Self::InvalidIdentifier
    }
}

pub fn decode_instant(value: generated::TimeInstant) -> Result<TimeInstant, ProtocolError> {
    let scale = match generated::TimeScale::try_from(value.time_scale) {
        Ok(generated::TimeScale::Tt) => "TT",
        Ok(generated::TimeScale::Tdb) => "TDB",
        Ok(generated::TimeScale::Utc) => "UTC",
        _ => return Err(ProtocolError::UnsupportedTimeScale),
    };
    TimeInstant::new(scale, value.epoch_id, value.seconds, value.nanos)
        .ok_or(ProtocolError::InvalidTime)
}
pub fn encode_instant(value: &TimeInstant) -> Result<generated::TimeInstant, ProtocolError> {
    let scale = match value.scale() {
        "TT" => generated::TimeScale::Tt,
        "TDB" => generated::TimeScale::Tdb,
        "UTC" => generated::TimeScale::Utc,
        _ => return Err(ProtocolError::UnsupportedTimeScale),
    };
    Ok(generated::TimeInstant {
        time_scale: scale as i32,
        epoch_id: value.epoch().to_owned(),
        seconds: value.seconds(),
        nanos: value.nanos(),
    })
}
pub fn decode_object_id(value: generated::ObjectId) -> Result<ObjectId, ProtocolError> {
    if value.value.len() > limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidIdentifier);
    }
    Ok(ObjectId::new(value.value)?)
}
pub fn decode_frame_id(value: generated::FrameId) -> Result<FrameId, ProtocolError> {
    if value.value.len() > limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidIdentifier);
    }
    Ok(FrameId::new(value.value)?)
}
pub fn decode_resource_id(value: generated::ResourceId) -> Result<ResourceId, ProtocolError> {
    if value.value.len() > limits::MAX_IDENTIFIER_BYTES {
        return Err(ProtocolError::InvalidIdentifier);
    }
    Ok(ResourceId::new(value.value)?)
}
#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message;

    #[test]
    fn time_roundtrip_preserves_signed_seconds_and_nanos() {
        let original = TimeInstant::new("TDB", "epoch-explicit", -12, 999_999_999).unwrap();
        let encoded = encode_instant(&original).unwrap().encode_to_vec();
        let decoded = generated::TimeInstant::decode(encoded.as_slice()).unwrap();
        assert_eq!(decode_instant(decoded).unwrap(), original);
    }
    #[test]
    fn unknown_scale_and_missing_epoch_are_rejected() {
        let mut value = generated::TimeInstant {
            time_scale: 0,
            epoch_id: "epoch".into(),
            seconds: 0,
            nanos: 0,
        };
        assert_eq!(
            decode_instant(value.clone()),
            Err(ProtocolError::UnsupportedTimeScale)
        );
        value.time_scale = generated::TimeScale::Tt as i32;
        value.epoch_id.clear();
        assert_eq!(decode_instant(value), Err(ProtocolError::InvalidTime));
    }
    #[test]
    fn empty_identity_is_rejected() {
        assert_eq!(
            decode_object_id(generated::ObjectId { value: " ".into() }),
            Err(ProtocolError::InvalidIdentifier)
        );
    }
}
