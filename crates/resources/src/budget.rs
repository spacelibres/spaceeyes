// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Logical reservations, not process RSS or device VRAM measurement.
use crate::{LeaseId, ResourceBudget, ResourceError, ResourceManager};
use spaceeyes_foundation::ResourceId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceClass {
    Cpu,
    Gpu,
    Staging,
}
impl ResourceClass {
    pub(crate) fn index(self) -> usize {
        match self {
            Self::Cpu => 0,
            Self::Gpu => 1,
            Self::Staging => 2,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResourceLimits {
    pub total_bytes: u64,
    pub cpu_bytes: u64,
    pub gpu_bytes: u64,
    pub staging_bytes: u64,
}
impl ResourceLimits {
    pub const PROTOTYPE: Self = Self {
        total_bytes: 256 * 1024 * 1024,
        cpu_bytes: 128 * 1024 * 1024,
        gpu_bytes: 128 * 1024 * 1024,
        staging_bytes: 32 * 1024 * 1024,
    };
    pub(crate) fn for_class(self, class: ResourceClass) -> u64 {
        match class {
            ResourceClass::Cpu => self.cpu_bytes,
            ResourceClass::Gpu => self.gpu_bytes,
            ResourceClass::Staging => self.staging_bytes,
        }
    }
}
impl From<ResourceBudget> for ResourceLimits {
    fn from(budget: ResourceBudget) -> Self {
        Self {
            total_bytes: budget.max_bytes,
            cpu_bytes: budget.max_bytes,
            gpu_bytes: budget.max_bytes,
            staging_bytes: budget.max_bytes,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResourceUsage {
    pub total_bytes: u64,
    pub cpu_bytes: u64,
    pub gpu_bytes: u64,
    pub staging_bytes: u64,
}
/// A frame owns both reservations. Opaque leases reject stale or cross-manager releases.
pub struct FrameReservation {
    gpu: LeaseId,
    staging: LeaseId,
}
impl ResourceManager {
    pub fn limits(&self) -> ResourceLimits {
        self.limits
    }
    pub fn usage(&self) -> ResourceUsage {
        ResourceUsage {
            total_bytes: self.used,
            cpu_bytes: self.by_class[0],
            gpu_bytes: self.by_class[1],
            staging_bytes: self.by_class[2],
        }
    }
    pub fn class(&self, id: &ResourceId) -> Option<ResourceClass> {
        self.entries.get(id).map(|e| e.class)
    }
    pub fn register_gpu(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        self.register_class(id, bytes, ResourceClass::Gpu)
    }
    pub fn register_staging(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        self.register_class(id, bytes, ResourceClass::Staging)
    }
    pub fn reserve_frame(
        &mut self,
        gpu_id: ResourceId,
        gpu_bytes: u64,
        staging_id: ResourceId,
        staging_bytes: u64,
    ) -> Result<FrameReservation, ResourceError> {
        if gpu_id == staging_id
            || self.entries.contains_key(&gpu_id)
            || self.entries.contains_key(&staging_id)
        {
            return Err(ResourceError::Duplicate);
        }
        if gpu_bytes == 0 || staging_bytes == 0 {
            return Err(ResourceError::InvalidSize);
        }
        let total = self
            .used
            .checked_add(gpu_bytes)
            .and_then(|v| v.checked_add(staging_bytes))
            .ok_or(ResourceError::Overflow)?;
        let gpu = self.by_class[1]
            .checked_add(gpu_bytes)
            .ok_or(ResourceError::Overflow)?;
        let staging = self.by_class[2]
            .checked_add(staging_bytes)
            .ok_or(ResourceError::Overflow)?;
        if total > self.limits.total_bytes
            || gpu > self.limits.gpu_bytes
            || staging > self.limits.staging_bytes
        {
            return Err(ResourceError::BudgetExceeded);
        }
        self.revision
            .checked_add(2)
            .ok_or(ResourceError::Overflow)?;
        self.next_lease
            .checked_add(2)
            .ok_or(ResourceError::Overflow)?;
        for id in [&gpu_id, &staging_id] {
            self.generations
                .get(id)
                .copied()
                .unwrap_or(0)
                .checked_add(1)
                .ok_or(ResourceError::Overflow)?;
        }
        // All fallible predicates are checked before the first mutation.
        self.register_gpu(gpu_id.clone(), gpu_bytes)
            .expect("prevalidated frame GPU");
        self.register_staging(staging_id.clone(), staging_bytes)
            .expect("prevalidated frame staging");
        Ok(FrameReservation {
            gpu: self.lease(&gpu_id).expect("prevalidated frame lease"),
            staging: self.lease(&staging_id).expect("prevalidated frame lease"),
        })
    }
    pub fn release_frame(&mut self, token: &FrameReservation) -> Result<(), ResourceError> {
        for (lease, class) in [
            (&token.gpu, ResourceClass::Gpu),
            (&token.staging, ResourceClass::Staging),
        ] {
            let entry = self
                .entries
                .get(lease.resource())
                .ok_or(ResourceError::InvalidLease)?;
            if self.active.get(&lease.sequence) != Some(lease)
                || entry.generation != lease.generation
                || entry.class != class
                || entry.leases == 0
            {
                return Err(ResourceError::InvalidLease);
            }
            if entry.leases != 1 {
                return Err(ResourceError::StillLeased);
            }
        }
        self.revision
            .checked_add(2)
            .ok_or(ResourceError::Overflow)?;
        self.release_lease(&token.gpu)
            .expect("prevalidated frame release");
        self.release_lease(&token.staging)
            .expect("prevalidated frame release");
        self.unregister(token.gpu.resource())
            .expect("prevalidated frame unregister");
        self.unregister(token.staging.resource())
            .expect("prevalidated frame unregister");
        Ok(())
    }
}
