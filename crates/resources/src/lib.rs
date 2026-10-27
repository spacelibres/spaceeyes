//! Authoritative logical resource registry and byte-budget accounting.
//! GPU allocation and plugin authorization remain outside this crate.
use std::collections::HashMap;
use spaceeyes_foundation::ResourceId;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResourceError {
    Duplicate, Unknown, InvalidSize, BudgetExceeded, InvalidLease,
    Overflow, StillLeased, EngineUnavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResourceBudget { pub max_bytes: u64 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceState { Registered, Released }
#[derive(Clone, Debug)]
struct Entry { bytes: u64, leases: u64 }
pub struct ResourceManager {
    entries: HashMap<ResourceId, Entry>,
    budget: ResourceBudget,
    used: u64,
    revision: u64,
}
impl ResourceManager {
    pub fn new(budget: ResourceBudget) -> Self {
        Self { entries: HashMap::new(), budget, used: 0, revision: 0 }
    }
    pub fn used_bytes(&self) -> u64 { self.used }
    pub fn revision(&self) -> u64 { self.revision }
    pub fn state(&self, id: &ResourceId) -> Option<ResourceState> {
        self.entries.get(id).map(|_| ResourceState::Registered)
    }
    pub fn register(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        if self.entries.contains_key(&id) { return Err(ResourceError::Duplicate); }
        if bytes == 0 { return Err(ResourceError::InvalidSize); }
        let used = self.used.checked_add(bytes).ok_or(ResourceError::Overflow)?;
        if used > self.budget.max_bytes { return Err(ResourceError::BudgetExceeded); }
        let revision = self.revision.checked_add(1).ok_or(ResourceError::Overflow)?;
        self.entries.insert(id, Entry { bytes, leases: 0 });
        self.used = used;
        self.revision = revision;
        Ok(())
    }
    pub fn lease(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        let entry = self.entries.get_mut(id).ok_or(ResourceError::Unknown)?;
        entry.leases = entry.leases.checked_add(1).ok_or(ResourceError::Overflow)?;
        Ok(())
    }
    pub fn release_lease(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        let entry = self.entries.get_mut(id).ok_or(ResourceError::Unknown)?;
        if entry.leases == 0 { return Err(ResourceError::InvalidLease); }
        entry.leases -= 1;
        Ok(())
    }
    pub fn unregister(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        if entry.leases > 0 { return Err(ResourceError::StillLeased); }
        let revision = self.revision.checked_add(1).ok_or(ResourceError::Overflow)?;
        let bytes = entry.bytes;
        self.entries.remove(id);
        self.used -= bytes;
        self.revision = revision;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn id(s: &str) -> ResourceId { ResourceId::new(s).unwrap() }
    #[test]
    fn shared_leases_prevent_early_release() {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 100 });
        r.register(id("texture"), 80).unwrap();
        r.lease(&id("texture")).unwrap();
        r.lease(&id("texture")).unwrap();
        assert_eq!(r.unregister(&id("texture")), Err(ResourceError::StillLeased));
        r.release_lease(&id("texture")).unwrap();
        r.release_lease(&id("texture")).unwrap();
        r.unregister(&id("texture")).unwrap();
        assert_eq!(r.used_bytes(), 0);
    }
    #[test]
    fn budget_rejection_is_atomic() {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 10 });
        assert_eq!(r.register(id("large"), 11), Err(ResourceError::BudgetExceeded));
        assert_eq!(r.used_bytes(), 0);
        assert_eq!(r.revision(), 0);
    }
}
