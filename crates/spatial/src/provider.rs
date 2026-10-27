//! Time-dependent transform providers. No ephemeris or transport assumptions.
use std::sync::Arc;
use spaceeyes_time::TimeInstant;
use crate::{RigidTransform, SpatialError};

/// A provider resolves child-frame coordinates into its parent frame.
/// Implementations may use interpolation or external ephemerides, but the core
/// does not infer coverage or perform scientific time-scale conversion.
pub trait TransformProvider: Send + Sync + std::fmt::Debug {
    fn provider_id(&self) -> &str;
    fn version(&self) -> &str;
    fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError>;
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
    pub fn provider_id(&self) -> &str { self.inner.provider_id() }
    pub fn version(&self) -> &str { self.inner.version() }
    pub fn resolve_at(&self, instant: &TimeInstant) -> Result<RigidTransform, SpatialError> {
        let transform = self.inner.resolve_at(instant)?;
        RigidTransform::new(transform.translation_m, transform.rotation)
    }
}
