// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Engine-owned mutation and read-only upload observation for a host principal.
use crate::{Engine, EngineState};
use spaceeyes_foundation::ResourceId;
use spaceeyes_resources::{ResourceError, UploadDescriptor, UploadStatus};

impl Engine {
    fn upload_sequence(&self) -> Result<u64, ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        self.frame_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)
    }
    pub fn begin_upload(
        &mut self,
        owner: &str,
        descriptor: UploadDescriptor,
    ) -> Result<UploadStatus, ResourceError> {
        self.begin_upload_at(owner, descriptor, 0)
    }
    /// Host-stamped variant used by policies that expire abandoned uploads.
    pub fn begin_upload_at(
        &mut self,
        owner: &str,
        descriptor: UploadDescriptor,
        tick: u64,
    ) -> Result<UploadStatus, ResourceError> {
        let sequence = self.upload_sequence()?;
        let status = self.resources.begin_upload_at(owner, descriptor, tick)?;
        self.frame_sequence = sequence;
        Ok(status)
    }
    /// Release upload reservations whose host-stamped age reached `ttl`.
    pub fn expire_uploads(&mut self, now: u64, ttl: u64) -> Result<Vec<String>, ResourceError> {
        if !self.accepts_commands() {
            return Err(ResourceError::EngineUnavailable);
        }
        Ok(self.resources.expire_uploads(now, ttl))
    }
    pub fn append_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<UploadStatus, ResourceError> {
        let sequence = self.upload_sequence()?;
        let status = self
            .resources
            .append_upload(owner, upload_id, offset, data)?;
        self.frame_sequence = sequence;
        Ok(status)
    }
    pub fn finish_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
    ) -> Result<ResourceId, ResourceError> {
        let sequence = self.upload_sequence()?;
        let before = self.resources.revision();
        let result = self.resources.finish_upload(owner, upload_id);
        // Invalid complete contents are cancelled, releasing both reservations.
        if self.resources.revision() != before {
            self.frame_sequence = sequence;
        }
        result
    }
    pub fn cancel_upload(
        &mut self,
        owner: &str,
        upload_id: &str,
    ) -> Result<ResourceId, ResourceError> {
        let sequence = self.upload_sequence()?;
        let id = self.resources.cancel_upload(owner, upload_id)?;
        self.frame_sequence = sequence;
        Ok(id)
    }
    pub fn upload_status(
        &self,
        owner: &str,
        upload_id: &str,
    ) -> Result<UploadStatus, ResourceError> {
        if self.state == EngineState::Stopped {
            return Err(ResourceError::EngineUnavailable);
        }
        self.resources.upload_status(owner, upload_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_resources::{UploadFormat, UploadSource};
    use spaceeyes_time::TimeInstant;
    fn descriptor() -> UploadDescriptor {
        UploadDescriptor {
            resource_id: ResourceId::new("sequence").unwrap(),
            total_bytes: 1,
            format: UploadFormat::Blob,
            source: UploadSource {
                source_id: "fixture".into(),
                source_version: "1".into(),
                sha256: [0; 32],
            },
        }
    }
    #[test]
    fn frame_sequence_overflow_prevents_every_resource_mutation() {
        let mut e = Engine::new(TimeInstant::new("TT", "epoch", 0, 0).unwrap());
        e.frame_sequence = u64::MAX;
        let before = e.snapshot();
        assert_eq!(
            e.begin_upload("alice", descriptor()),
            Err(ResourceError::Overflow)
        );
        assert_eq!(e.snapshot(), before);
        assert_eq!(e.resource_used_bytes(), 0);
        e.frame_sequence = 0;
        let s = e.begin_upload("alice", descriptor()).unwrap();
        e.frame_sequence = u64::MAX;
        let before = e.snapshot();
        assert_eq!(
            e.append_upload("alice", &s.upload_id, 0, &[1]),
            Err(ResourceError::Overflow)
        );
        assert_eq!(
            e.cancel_upload("alice", &s.upload_id),
            Err(ResourceError::Overflow)
        );
        assert_eq!(e.upload_status("alice", &s.upload_id).unwrap(), s);
        assert_eq!(e.snapshot(), before);
        e.frame_sequence = 0;
        let s = e.append_upload("alice", &s.upload_id, 0, &[1]).unwrap();
        e.frame_sequence = u64::MAX;
        let before = e.snapshot();
        assert_eq!(
            e.finish_upload("alice", &s.upload_id),
            Err(ResourceError::Overflow)
        );
        assert_eq!(e.upload_status("alice", &s.upload_id).unwrap(), s);
        assert_eq!(e.snapshot(), before);
        assert_eq!(e.resource_usage().staging_bytes, 1);
    }
}
