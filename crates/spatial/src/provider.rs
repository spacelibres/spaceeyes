// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Time-dependent transform providers. No ephemeris or transport assumptions.
use crate::{FrameDerivative, RigidTransform, SpatialError};
use spaceeyes_time::TimeInstant;
use std::sync::Arc;

/// A provider resolves child-frame coordinates into its parent frame.
/// Implementations may use interpolation or external ephemerides, but the core
/// does not infer coverage or perform scientific time-scale conversion.
pub trait TransformProvider: Send + Sync + std::fmt::Debug {
    fn provider_id(&self) -> &str;
    fn version(&self) -> &str;
    fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError>;
    /// Optional declared validity interval in one time scale and epoch.
    /// Returning `None` means the provider does not publish coverage.
    fn coverage(&self) -> Option<(TimeInstant, TimeInstant)> {
        None
    }
    /// Optional first derivative in the parent frame at the same instant.
    /// Returning `None` means velocity transforms are unsupported; never assume zero.
    fn derivative_at(
        &self,
        _instant: &TimeInstant,
    ) -> Result<Option<FrameDerivative>, SpatialError> {
        Ok(None)
    }
}

#[derive(Clone, Debug)]
pub struct ProviderRef {
    pub(crate) inner: Arc<dyn TransformProvider>,
}
impl ProviderRef {
    pub fn new(provider: Arc<dyn TransformProvider>) -> Result<Self, SpatialError> {
        if provider.provider_id().trim().is_empty() || provider.version().trim().is_empty() {
            return Err(SpatialError::InvalidProvider);
        }
        Ok(Self { inner: provider })
    }
    pub fn provider_id(&self) -> &str {
        self.inner.provider_id()
    }
    pub fn version(&self) -> &str {
        self.inner.version()
    }
    pub fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        let transform = self.inner.resolve_at(instant)?;
        RigidTransform::new(transform.translation_m, transform.rotation)
    }
    pub fn derivative_at(
        &self,
        instant: &TimeInstant,
    ) -> Result<Option<FrameDerivative>, SpatialError> {
        match self.inner.derivative_at(instant)? {
            Some(derivative) if derivative.finite() => Ok(Some(derivative)),
            Some(_) => Err(SpatialError::InvalidTransform),
            None => Ok(None),
        }
    }
    pub fn coverage(&self) -> Result<Option<(TimeInstant, TimeInstant)>, SpatialError> {
        let Some((start, end)) = self.inner.coverage() else {
            return Ok(None);
        };
        if start.scale() != end.scale() || start.epoch() != end.epoch() {
            return Err(SpatialError::InvalidProvider);
        }
        if (start.seconds(), start.nanos()) > (end.seconds(), end.nanos()) {
            return Err(SpatialError::InvalidProvider);
        }
        Ok(Some((start, end)))
    }
}
