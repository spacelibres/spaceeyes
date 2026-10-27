// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Versioned project file container with an explicit SHA-256 integrity check.
//!
//! Layout: magic (8) | format version (u16 LE) | payload length (u32 LE) |
//! SHA-256 of payload (32) | UTF-8-free protobuf ProjectSnapshot payload.
//! Raw protobuf is not accepted as a file: a file must carry its digest so a
//! truncated or edited project can never silently replace the current session.
use crate::{decode_project_bytes, encode_project, generated as p, ProtocolError};
use prost::Message;
use sha2::{Digest, Sha256};
use spaceeyes_engine::ProjectState;

pub const PROJECT_FILE_MAGIC: &[u8; 8] = b"SEYESPRJ";
pub const PROJECT_FILE_VERSION: u16 = 1;
pub const PROJECT_FILE_HEADER_BYTES: usize = 8 + 2 + 4 + 32;
pub const MAX_PROJECT_FILE_BYTES: usize = 16 * 1024 * 1024;

/// Wrap an exported `ProjectSnapshot` payload in a verified file container.
/// The payload must already be a valid project snapshot.
pub fn wrap_project_bytes(payload: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    decode_project_bytes(payload)?;
    if payload.is_empty() || payload.len() > MAX_PROJECT_FILE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    let Ok(length) = u32::try_from(payload.len()) else {
        return Err(ProtocolError::MessageTooLarge);
    };
    let mut file = Vec::with_capacity(PROJECT_FILE_HEADER_BYTES + payload.len());
    file.extend_from_slice(PROJECT_FILE_MAGIC);
    file.extend_from_slice(&PROJECT_FILE_VERSION.to_le_bytes());
    file.extend_from_slice(&length.to_le_bytes());
    file.extend_from_slice(&Sha256::digest(payload));
    file.extend_from_slice(payload);
    Ok(file)
}

/// Validate the container and return the raw `ProjectSnapshot` payload.
pub fn unwrap_project_bytes(file: &[u8]) -> Result<&[u8], ProtocolError> {
    if file.len() < PROJECT_FILE_HEADER_BYTES {
        return Err(ProtocolError::InvalidContext);
    }
    if &file[..8] != PROJECT_FILE_MAGIC {
        return Err(ProtocolError::InvalidContext);
    }
    let version = u16::from_le_bytes([file[8], file[9]]);
    if version != PROJECT_FILE_VERSION {
        return Err(ProtocolError::UnsupportedVersion);
    }
    let length = u32::from_le_bytes([file[10], file[11], file[12], file[13]]) as usize;
    if length == 0 || length > MAX_PROJECT_FILE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    if file.len() != PROJECT_FILE_HEADER_BYTES + length {
        return Err(ProtocolError::InvalidContext);
    }
    let digest = &file[14..PROJECT_FILE_HEADER_BYTES];
    let payload = &file[PROJECT_FILE_HEADER_BYTES..];
    if Sha256::digest(payload).as_slice() != digest {
        return Err(ProtocolError::IntegrityMismatch);
    }
    Ok(payload)
}

pub fn encode_project_file(state: &ProjectState) -> Result<Vec<u8>, ProtocolError> {
    let snapshot: p::ProjectSnapshot = encode_project(state)?;
    wrap_project_bytes(&snapshot.encode_to_vec())
}

pub fn decode_project_file(file: &[u8]) -> Result<ProjectState, ProtocolError> {
    decode_project_bytes(unwrap_project_bytes(file)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_foundation::ObjectId;
    use spaceeyes_scene::{SceneCommand, SceneObject};
    use spaceeyes_time::TimeInstant;

    fn state() -> ProjectState {
        let mut engine =
            spaceeyes_engine::Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
        engine
            .submit_scene(
                spaceeyes_foundation::Revision(0),
                &[SceneCommand::Create(SceneObject::new(
                    ObjectId::new("body").unwrap(),
                ))],
            )
            .unwrap();
        engine.project_state()
    }

    #[test]
    fn file_roundtrip_preserves_state_and_digest_boundaries() {
        let original = state();
        let file = encode_project_file(&original).unwrap();
        assert_eq!(&file[..8], PROJECT_FILE_MAGIC);
        assert_eq!(&file[8..10], &1u16.to_le_bytes());
        assert_eq!(decode_project_file(&file).unwrap(), original);

        let payload = unwrap_project_bytes(&file).unwrap();
        assert_eq!(wrap_project_bytes(payload).unwrap(), file);
    }

    #[test]
    fn tampered_truncated_or_mis_versioned_files_are_rejected() {
        let file = encode_project_file(&state()).unwrap();
        let mut tampered = file.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert_eq!(
            decode_project_file(&tampered),
            Err(ProtocolError::IntegrityMismatch)
        );

        assert_eq!(
            decode_project_file(&file[..file.len() - 1]),
            Err(ProtocolError::InvalidContext)
        );
        let mut extended = file.clone();
        extended.push(0);
        assert_eq!(
            decode_project_file(&extended),
            Err(ProtocolError::InvalidContext)
        );

        let mut future = file.clone();
        future[8..10].copy_from_slice(&2u16.to_le_bytes());
        assert_eq!(
            decode_project_file(&future),
            Err(ProtocolError::UnsupportedVersion)
        );

        assert_eq!(
            decode_project_file(b"not a project file"),
            Err(ProtocolError::InvalidContext)
        );
    }

    #[test]
    fn raw_protobuf_is_not_a_verified_file() {
        let payload = encode_project(&state()).unwrap().encode_to_vec();
        assert!(decode_project_bytes(&payload).is_ok());
        assert_eq!(
            decode_project_file(&payload),
            Err(ProtocolError::InvalidContext)
        );
        // Wrapping validates the payload before signing it.
        let wrapped = wrap_project_bytes(&payload).unwrap();
        assert_eq!(decode_project_file(&wrapped).unwrap(), state());
        assert_eq!(
            wrap_project_bytes(b"garbage"),
            Err(ProtocolError::InvalidContext)
        );
    }
}
