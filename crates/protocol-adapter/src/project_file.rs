// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Versioned project file container with an explicit SHA-256 integrity check.
//!
//! v1 layout: magic (8) | format version (u16 LE) | payload length (u32 LE) |
//! SHA-256 of payload (32) | ProjectSnapshot payload.
//! v2 layout: magic (8) | format version=2 (u16 LE) | manifest length (u32 LE) |
//! payload length (u32 LE) | SHA-256 of manifest||payload (32) | manifest | payload.
//! A manifest is `id_len (u16 LE) | id UTF-8 | created_unix_nanos (i64 LE) |
//! updated_unix_nanos (i64 LE)`.
//! Raw protobuf is not accepted as a file: a file must carry its digest so a
//! truncated or edited project can never silently replace the current session.
use crate::{decode_project_bytes, encode_project, generated as p, ProtocolError};
use prost::Message;
use sha2::{Digest, Sha256};
use spaceeyes_engine::ProjectState;

pub const PROJECT_FILE_MAGIC: &[u8; 8] = b"SEYESPRJ";
pub const PROJECT_FILE_VERSION: u16 = 2;
pub const LEGACY_PROJECT_FILE_VERSION: u16 = 1;
/// v1 header without a manifest.
pub const LEGACY_PROJECT_FILE_HEADER_BYTES: usize = 8 + 2 + 4 + 32;
/// Current (v2) header without the manifest bytes.
pub const PROJECT_FILE_HEADER_BYTES: usize = 8 + 2 + 4 + 4 + 32;
pub const MAX_PROJECT_FILE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PROJECT_ID_BYTES: usize = 256;
const MAX_MANIFEST_BYTES: usize = 2 + MAX_PROJECT_ID_BYTES + 16;

/// Host wall-clock metadata. These values are never interpreted as simulation time.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProjectManifest {
    pub project_id: String,
    pub created_at_unix_nanos: i64,
    pub updated_at_unix_nanos: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectFileInfo {
    pub format_version: u16,
    pub manifest: ProjectManifest,
}

/// Wrap an exported `ProjectSnapshot` payload in the compact v1 container.
pub fn wrap_project_bytes(payload: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    decode_project_bytes(payload)?;
    if payload.is_empty() || payload.len() > MAX_PROJECT_FILE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    let Ok(length) = u32::try_from(payload.len()) else {
        return Err(ProtocolError::MessageTooLarge);
    };
    let mut file = Vec::with_capacity(LEGACY_PROJECT_FILE_HEADER_BYTES + payload.len());
    file.extend_from_slice(PROJECT_FILE_MAGIC);
    file.extend_from_slice(&LEGACY_PROJECT_FILE_VERSION.to_le_bytes());
    file.extend_from_slice(&length.to_le_bytes());
    file.extend_from_slice(&Sha256::digest(payload));
    file.extend_from_slice(payload);
    Ok(file)
}

/// Wrap a validated payload with a manifest. The digest covers both parts.
pub fn wrap_project_bytes_with_manifest(
    payload: &[u8],
    manifest: &ProjectManifest,
) -> Result<Vec<u8>, ProtocolError> {
    decode_project_bytes(payload)?;
    if payload.is_empty() || payload.len() > MAX_PROJECT_FILE_BYTES {
        return Err(ProtocolError::MessageTooLarge);
    }
    let manifest = encode_manifest(manifest)?;
    let (Ok(manifest_len), Ok(payload_len)) =
        (u32::try_from(manifest.len()), u32::try_from(payload.len()))
    else {
        return Err(ProtocolError::MessageTooLarge);
    };
    let mut file = Vec::with_capacity(PROJECT_FILE_HEADER_BYTES + manifest.len() + payload.len());
    file.extend_from_slice(PROJECT_FILE_MAGIC);
    file.extend_from_slice(&PROJECT_FILE_VERSION.to_le_bytes());
    file.extend_from_slice(&manifest_len.to_le_bytes());
    file.extend_from_slice(&payload_len.to_le_bytes());
    let mut hasher = Sha256::new();
    hasher.update(&manifest);
    hasher.update(payload);
    file.extend_from_slice(&hasher.finalize());
    file.extend_from_slice(&manifest);
    file.extend_from_slice(payload);
    Ok(file)
}

/// Validate the container and return its payload for both supported versions.
pub fn unwrap_project_bytes(file: &[u8]) -> Result<&[u8], ProtocolError> {
    Ok(parse_project_file(file)?.1)
}

/// Read format version, manifest, and the decoded project state.
pub fn read_project_file(file: &[u8]) -> Result<(ProjectFileInfo, ProjectState), ProtocolError> {
    let (info, payload) = parse_project_file(file)?;
    Ok((info, decode_project_bytes(payload)?))
}

fn parse_project_file(file: &[u8]) -> Result<(ProjectFileInfo, &[u8]), ProtocolError> {
    if file.len() < LEGACY_PROJECT_FILE_HEADER_BYTES || &file[..8] != PROJECT_FILE_MAGIC {
        return Err(ProtocolError::InvalidContext);
    }
    let version = u16::from_le_bytes([file[8], file[9]]);
    match version {
        LEGACY_PROJECT_FILE_VERSION => {
            let length = u32::from_le_bytes([file[10], file[11], file[12], file[13]]) as usize;
            if length == 0 || length > MAX_PROJECT_FILE_BYTES {
                return Err(ProtocolError::MessageTooLarge);
            }
            if file.len() != LEGACY_PROJECT_FILE_HEADER_BYTES + length {
                return Err(ProtocolError::InvalidContext);
            }
            let digest = &file[14..LEGACY_PROJECT_FILE_HEADER_BYTES];
            let payload = &file[LEGACY_PROJECT_FILE_HEADER_BYTES..];
            if Sha256::digest(payload).as_slice() != digest {
                return Err(ProtocolError::IntegrityMismatch);
            }
            Ok((
                ProjectFileInfo {
                    format_version: version,
                    manifest: ProjectManifest::default(),
                },
                payload,
            ))
        }
        PROJECT_FILE_VERSION => {
            if file.len() < PROJECT_FILE_HEADER_BYTES {
                return Err(ProtocolError::InvalidContext);
            }
            let manifest_len =
                u32::from_le_bytes([file[10], file[11], file[12], file[13]]) as usize;
            let payload_len = u32::from_le_bytes([file[14], file[15], file[16], file[17]]) as usize;
            if manifest_len > MAX_MANIFEST_BYTES || payload_len == 0 {
                return Err(ProtocolError::MessageTooLarge);
            }
            if payload_len > MAX_PROJECT_FILE_BYTES {
                return Err(ProtocolError::MessageTooLarge);
            }
            let expected = PROJECT_FILE_HEADER_BYTES
                .checked_add(manifest_len)
                .and_then(|value| value.checked_add(payload_len))
                .ok_or(ProtocolError::MessageTooLarge)?;
            if file.len() != expected {
                return Err(ProtocolError::InvalidContext);
            }
            let digest = &file[18..PROJECT_FILE_HEADER_BYTES];
            let manifest_bytes =
                &file[PROJECT_FILE_HEADER_BYTES..PROJECT_FILE_HEADER_BYTES + manifest_len];
            let payload = &file[PROJECT_FILE_HEADER_BYTES + manifest_len..];
            let mut hasher = Sha256::new();
            hasher.update(manifest_bytes);
            hasher.update(payload);
            if hasher.finalize().as_slice() != digest {
                return Err(ProtocolError::IntegrityMismatch);
            }
            let manifest = decode_manifest(manifest_bytes)?;
            Ok((
                ProjectFileInfo {
                    format_version: version,
                    manifest,
                },
                payload,
            ))
        }
        _ => Err(ProtocolError::UnsupportedVersion),
    }
}

fn encode_manifest(manifest: &ProjectManifest) -> Result<Vec<u8>, ProtocolError> {
    let id = manifest.project_id.as_bytes();
    if id.len() > MAX_PROJECT_ID_BYTES
        || manifest.created_at_unix_nanos > manifest.updated_at_unix_nanos
    {
        return Err(ProtocolError::InvalidContext);
    }
    let Ok(id_len) = u16::try_from(id.len()) else {
        return Err(ProtocolError::InvalidContext);
    };
    let mut bytes = Vec::with_capacity(2 + id.len() + 16);
    bytes.extend_from_slice(&id_len.to_le_bytes());
    bytes.extend_from_slice(id);
    bytes.extend_from_slice(&manifest.created_at_unix_nanos.to_le_bytes());
    bytes.extend_from_slice(&manifest.updated_at_unix_nanos.to_le_bytes());
    Ok(bytes)
}

fn decode_manifest(bytes: &[u8]) -> Result<ProjectManifest, ProtocolError> {
    if bytes.len() < 18 {
        return Err(ProtocolError::InvalidContext);
    }
    let id_len = u16::from_le_bytes([bytes[0], bytes[1]]) as usize;
    if bytes.len() != 2 + id_len + 16 || id_len > MAX_PROJECT_ID_BYTES {
        return Err(ProtocolError::InvalidContext);
    }
    let project_id = std::str::from_utf8(&bytes[2..2 + id_len])
        .map_err(|_| ProtocolError::InvalidContext)?
        .to_owned();
    let created = i64::from_le_bytes(
        bytes[2 + id_len..2 + id_len + 8]
            .try_into()
            .map_err(|_| ProtocolError::InvalidContext)?,
    );
    let updated = i64::from_le_bytes(
        bytes[2 + id_len + 8..2 + id_len + 16]
            .try_into()
            .map_err(|_| ProtocolError::InvalidContext)?,
    );
    if created > updated {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(ProjectManifest {
        project_id,
        created_at_unix_nanos: created,
        updated_at_unix_nanos: updated,
    })
}

pub fn encode_project_file(state: &ProjectState) -> Result<Vec<u8>, ProtocolError> {
    let snapshot: p::ProjectSnapshot = encode_project(state)?;
    wrap_project_bytes(&snapshot.encode_to_vec())
}

pub fn encode_project_file_with_manifest(
    state: &ProjectState,
    manifest: &ProjectManifest,
) -> Result<Vec<u8>, ProtocolError> {
    let snapshot: p::ProjectSnapshot = encode_project(state)?;
    wrap_project_bytes_with_manifest(&snapshot.encode_to_vec(), manifest)
}

pub fn decode_project_file(file: &[u8]) -> Result<ProjectState, ProtocolError> {
    read_project_file(file).map(|(_, state)| state)
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

    fn manifest() -> ProjectManifest {
        ProjectManifest {
            project_id: "solar-study".into(),
            created_at_unix_nanos: 1_000,
            updated_at_unix_nanos: 2_000,
        }
    }

    #[test]
    fn legacy_v1_and_manifest_v2_roundtrip_with_their_metadata() {
        let original = state();
        let v1 = encode_project_file(&original).unwrap();
        let (info, decoded) = read_project_file(&v1).unwrap();
        assert_eq!(info.format_version, 1);
        assert_eq!(info.manifest, ProjectManifest::default());
        assert_eq!(decoded, original);

        let v2 = encode_project_file_with_manifest(&original, &manifest()).unwrap();
        let (info, decoded) = read_project_file(&v2).unwrap();
        assert_eq!(info.format_version, 2);
        assert_eq!(info.manifest, manifest());
        assert_eq!(decoded, original);
        let payload = unwrap_project_bytes(&v2).unwrap();
        assert_eq!(
            wrap_project_bytes_with_manifest(payload, &manifest()).unwrap(),
            v2
        );
    }

    #[test]
    fn tampered_truncated_or_mis_versioned_files_are_rejected() {
        for file in [
            encode_project_file(&state()).unwrap(),
            encode_project_file_with_manifest(&state(), &manifest()).unwrap(),
        ] {
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
            future[8..10].copy_from_slice(&3u16.to_le_bytes());
            assert_eq!(
                decode_project_file(&future),
                Err(ProtocolError::UnsupportedVersion)
            );
        }
        assert_eq!(
            decode_project_file(b"not a project file"),
            Err(ProtocolError::InvalidContext)
        );
    }

    #[test]
    fn manifest_fields_are_bounded_and_ordered() {
        assert_eq!(
            encode_project_file_with_manifest(
                &state(),
                &ProjectManifest {
                    project_id: "x".repeat(MAX_PROJECT_ID_BYTES + 1),
                    ..ProjectManifest::default()
                }
            ),
            Err(ProtocolError::InvalidContext)
        );
        assert_eq!(
            encode_project_file_with_manifest(
                &state(),
                &ProjectManifest {
                    created_at_unix_nanos: 2,
                    updated_at_unix_nanos: 1,
                    ..ProjectManifest::default()
                }
            ),
            Err(ProtocolError::InvalidContext)
        );

        let mut file = encode_project_file_with_manifest(&state(), &manifest()).unwrap();
        // Tamper the last manifest byte (manifest is before the payload).
        let index = PROJECT_FILE_HEADER_BYTES + 2 + "solar-study".len() + 16 - 1;
        let before = file[index];
        file[index] ^= 0xff;
        assert_ne!(before, file[index]);
        assert_eq!(
            decode_project_file(&file),
            Err(ProtocolError::IntegrityMismatch)
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
        let wrapped = wrap_project_bytes(&payload).unwrap();
        assert_eq!(decode_project_file(&wrapped).unwrap(), state());
        assert_eq!(
            wrap_project_bytes(b"garbage"),
            Err(ProtocolError::InvalidContext)
        );
    }
}
