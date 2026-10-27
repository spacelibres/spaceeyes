//! Authoritative resource registry. Leases are opaque, single-release tokens.
//! IDs are stable logical references; internal generations reject stale tokens.
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
pub enum ResourceState { Registered }
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct LeaseId {
    resource: ResourceId,
    generation: u64,
    sequence: u64,
}
impl LeaseId {
    pub fn resource(&self) -> &ResourceId { &self.resource }
}
#[derive(Clone, Debug)]
struct Entry { bytes: u64, generation: u64, leases: u64 }
pub struct ResourceManager {
    entries: HashMap<ResourceId, Entry>,
    active: HashMap<u64, LeaseId>,
    generations: HashMap<ResourceId, u64>,
    next_lease: u64,
    budget: ResourceBudget,
    used: u64,
    revision: u64,
}
impl ResourceManager {
    pub fn new(budget: ResourceBudget) -> Self {
        Self { entries: HashMap::new(), active: HashMap::new(), generations: HashMap::new(),
            next_lease: 0, budget, used: 0, revision: 0 }
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
        let generation = self.generations.get(&id).copied().unwrap_or(0)
            .checked_add(1).ok_or(ResourceError::Overflow)?;
        self.generations.insert(id.clone(), generation);
        self.entries.insert(id, Entry { bytes, generation, leases: 0 });
        self.used = used;
        self.revision = revision;
        Ok(())
    }
    pub fn lease(&mut self, id: &ResourceId) -> Result<LeaseId, ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        let count = entry.leases.checked_add(1).ok_or(ResourceError::Overflow)?;
        let sequence = self.next_lease.checked_add(1).ok_or(ResourceError::Overflow)?;
        let token = LeaseId { resource: id.clone(), generation: entry.generation, sequence };
        self.entries.get_mut(id).expect("validated").leases = count;
        self.active.insert(sequence, token.clone());
        self.next_lease = sequence;
        Ok(token)
    }
    pub fn release_lease(&mut self, token: &LeaseId) -> Result<(), ResourceError> {
        let entry = self.entries.get(&token.resource).ok_or(ResourceError::InvalidLease)?;
        if entry.generation != token.generation || entry.leases == 0
            || self.active.get(&token.sequence) != Some(token) {
            return Err(ResourceError::InvalidLease);
        }
        self.active.remove(&token.sequence);
        self.entries.get_mut(&token.resource).expect("validated").leases -= 1;
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
    fn lease_is_single_release_and_generation_safe() {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 100 });
        let resource = id("texture");
        r.register(resource.clone(), 80).unwrap();
        let first = r.lease(&resource).unwrap();
        let second = r.lease(&resource).unwrap();
        assert_eq!(r.unregister(&resource), Err(ResourceError::StillLeased));
        r.release_lease(&first).unwrap();
        assert_eq!(r.release_lease(&first), Err(ResourceError::InvalidLease));
        r.release_lease(&second).unwrap();
        r.unregister(&resource).unwrap();
        r.register(resource.clone(), 20).unwrap();
        assert_eq!(r.release_lease(&first), Err(ResourceError::InvalidLease));
        assert_eq!(r.used_bytes(), 20);
    }
    #[test]
    fn budget_rejection_is_atomic() {
        let mut r = ResourceManager::new(ResourceBudget { max_bytes: 10 });
        assert_eq!(r.register(id("large"), 11), Err(ResourceError::BudgetExceeded));
        assert_eq!(r.used_bytes(), 0);
        assert_eq!(r.revision(), 0);
    }
}
