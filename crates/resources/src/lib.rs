// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Authoritative resource registry. Leases are opaque, single-release tokens.
//! IDs are stable logical references; internal generations reject stale tokens.
use spaceeyes_foundation::ResourceId;
use spaceeyes_geometry::{TextureData, TriangleMesh};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
static NEXT_MANAGER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResourceError {
    Duplicate,
    Unknown,
    InvalidSize,
    BudgetExceeded,
    InvalidLease,
    Overflow,
    StillLeased,
    EngineUnavailable,
    InvalidState,
    StaleLoad,
    NotReady,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResourceBudget {
    pub max_bytes: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceState {
    Registered,
    Declared,
    Loading,
    Ready,
    Failed,
    Cancelled,
}
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct LeaseId {
    manager: u64,
    resource: ResourceId,
    generation: u64,
    sequence: u64,
}
impl LeaseId {
    pub fn resource(&self) -> &ResourceId {
        &self.resource
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoadToken {
    manager: u64,
    resource: ResourceId,
    generation: u64,
    sequence: u64,
}
#[derive(Clone, Debug)]
struct Entry {
    state: ResourceState,
    load_sequence: u64,
    data: Option<Arc<[u8]>>,
    mesh: Option<Arc<TriangleMesh>>,
    texture: Option<Arc<TextureData>>,
    bytes: u64,
    generation: u64,
    leases: u64,
}
/// Portable CPU contents or a declaration, without lease or load identities.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceRecord {
    pub id: ResourceId,
    pub bytes: u64,
    pub data: Option<Vec<u8>>,
    pub mesh: Option<TriangleMesh>,
    pub texture: Option<TextureData>,
    pub logical_only: bool,
}
#[derive(Clone)]
pub struct ResourceManager {
    identity: u64,
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
        Self {
            identity: NEXT_MANAGER
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
                .expect("resource identity exhausted"),
            entries: HashMap::new(),
            active: HashMap::new(),
            generations: HashMap::new(),
            next_lease: 0,
            budget,
            used: 0,
            revision: 0,
        }
    }
    pub fn records(&self) -> Vec<ResourceRecord> {
        let mut records: Vec<_> = self
            .entries
            .iter()
            .map(|(id, e)| ResourceRecord {
                id: id.clone(),
                bytes: e.bytes,
                data: e.data.as_ref().map(|d| d.to_vec()),
                mesh: e.mesh.as_deref().cloned(),
                texture: e.texture.as_deref().cloned(),
                logical_only: e.state == ResourceState::Registered,
            })
            .collect();
        records.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
        records
    }
    pub fn restore(
        budget: ResourceBudget,
        records: &[ResourceRecord],
    ) -> Result<Self, ResourceError> {
        let mut result = Self::new(budget);
        for record in records {
            if usize::from(record.data.is_some())
                + usize::from(record.mesh.is_some())
                + usize::from(record.texture.is_some())
                > 1
            {
                return Err(ResourceError::InvalidState);
            }
            if let Some(texture) = &record.texture {
                if record.logical_only || record.bytes != texture.byte_len() {
                    return Err(ResourceError::InvalidSize);
                }
                result.register_texture(record.id.clone(), texture.clone())?;
                continue;
            }
            if let Some(mesh) = &record.mesh {
                if record.logical_only || record.data.is_some() || record.bytes != mesh.byte_len() {
                    return Err(ResourceError::InvalidSize);
                }
                result.register_mesh(record.id.clone(), mesh.clone())?;
                continue;
            }
            if record.logical_only {
                if record.data.is_some() {
                    return Err(ResourceError::InvalidState);
                }
                result.register(record.id.clone(), record.bytes)?;
            } else {
                result.declare(record.id.clone(), record.bytes)?;
                if let Some(bytes) = &record.data {
                    let token = result.begin_load(&record.id)?;
                    result.complete_load(&token, bytes.clone())?;
                }
            }
        }
        Ok(result)
    }
    pub fn register_mesh(
        &mut self,
        id: ResourceId,
        mesh: TriangleMesh,
    ) -> Result<(), ResourceError> {
        self.register(id.clone(), mesh.byte_len())?;
        let entry = self.entries.get_mut(&id).expect("registered");
        entry.mesh = Some(Arc::new(mesh));
        entry.state = ResourceState::Ready;
        Ok(())
    }
    pub fn register_texture(
        &mut self,
        id: ResourceId,
        texture: TextureData,
    ) -> Result<(), ResourceError> {
        self.register(id.clone(), texture.byte_len())?;
        let entry = self.entries.get_mut(&id).expect("registered");
        entry.texture = Some(Arc::new(texture));
        entry.state = ResourceState::Ready;
        Ok(())
    }
    pub fn texture_available(&self, id: &ResourceId) -> bool {
        self.entries
            .get(id)
            .is_some_and(|e| e.state == ResourceState::Ready && e.texture.is_some())
    }
    pub fn read_texture(&self, token: &LeaseId) -> Result<Arc<TextureData>, ResourceError> {
        if self.active.get(&token.sequence) != Some(token) {
            return Err(ResourceError::InvalidLease);
        }
        self.entries
            .get(&token.resource)
            .and_then(|e| e.texture.clone())
            .ok_or(ResourceError::NotReady)
    }
    pub fn mesh_available(&self, id: &ResourceId) -> bool {
        self.entries
            .get(id)
            .is_some_and(|entry| entry.state == ResourceState::Ready && entry.mesh.is_some())
    }
    pub fn read_mesh(&self, token: &LeaseId) -> Result<Arc<TriangleMesh>, ResourceError> {
        if self.active.get(&token.sequence) != Some(token) {
            return Err(ResourceError::InvalidLease);
        }
        self.entries
            .get(&token.resource)
            .and_then(|e| e.mesh.clone())
            .ok_or(ResourceError::NotReady)
    }
    pub fn used_bytes(&self) -> u64 {
        self.used
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn state(&self, id: &ResourceId) -> Option<ResourceState> {
        self.entries.get(id).map(|e| e.state)
    }
    pub fn register(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        if self.entries.contains_key(&id) {
            return Err(ResourceError::Duplicate);
        }
        if bytes == 0 {
            return Err(ResourceError::InvalidSize);
        }
        let used = self
            .used
            .checked_add(bytes)
            .ok_or(ResourceError::Overflow)?;
        if used > self.budget.max_bytes {
            return Err(ResourceError::BudgetExceeded);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let generation = self
            .generations
            .get(&id)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.generations.insert(id.clone(), generation);
        self.entries.insert(
            id,
            Entry {
                state: ResourceState::Registered,
                load_sequence: 0,
                data: None,
                mesh: None,
                texture: None,
                bytes,
                generation,
                leases: 0,
            },
        );
        self.used = used;
        self.revision = revision;
        Ok(())
    }
    /// Reserve CPU bytes without claiming the data has loaded.
    pub fn declare(&mut self, id: ResourceId, bytes: u64) -> Result<(), ResourceError> {
        self.register(id.clone(), bytes)?;
        self.entries.get_mut(&id).expect("registered").state = ResourceState::Declared;
        Ok(())
    }
    pub fn begin_load(&mut self, id: &ResourceId) -> Result<LoadToken, ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        if !matches!(
            entry.state,
            ResourceState::Declared | ResourceState::Failed | ResourceState::Cancelled
        ) {
            return Err(ResourceError::InvalidState);
        }
        let sequence = entry
            .load_sequence
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let entry = self.entries.get_mut(id).expect("validated");
        entry.state = ResourceState::Loading;
        entry.load_sequence = sequence;
        self.revision = revision;
        Ok(LoadToken {
            manager: self.identity,
            resource: id.clone(),
            generation: entry.generation,
            sequence,
        })
    }
    fn loading(&self, token: &LoadToken) -> Result<&Entry, ResourceError> {
        if token.manager != self.identity {
            return Err(ResourceError::StaleLoad);
        }
        let entry = self
            .entries
            .get(&token.resource)
            .ok_or(ResourceError::StaleLoad)?;
        if entry.generation != token.generation
            || entry.load_sequence != token.sequence
            || entry.state != ResourceState::Loading
        {
            return Err(ResourceError::StaleLoad);
        }
        Ok(entry)
    }
    pub fn complete_load(&mut self, token: &LoadToken, data: Vec<u8>) -> Result<(), ResourceError> {
        let entry = self.loading(token)?;
        if u64::try_from(data.len()).map_err(|_| ResourceError::InvalidSize)? != entry.bytes {
            return Err(ResourceError::InvalidSize);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let entry = self.entries.get_mut(&token.resource).expect("validated");
        entry.data = Some(data.into());
        entry.state = ResourceState::Ready;
        self.revision = revision;
        Ok(())
    }
    pub fn cancel_load(&mut self, token: &LoadToken) -> Result<(), ResourceError> {
        self.end_load(token, ResourceState::Cancelled)
    }
    pub fn fail_load(&mut self, token: &LoadToken) -> Result<(), ResourceError> {
        self.end_load(token, ResourceState::Failed)
    }
    fn end_load(&mut self, token: &LoadToken, state: ResourceState) -> Result<(), ResourceError> {
        self.loading(token)?;
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        self.entries
            .get_mut(&token.resource)
            .expect("validated")
            .state = state;
        self.revision = revision;
        Ok(())
    }
    pub fn read(&self, token: &LeaseId) -> Result<&[u8], ResourceError> {
        if self.active.get(&token.sequence) != Some(token) {
            return Err(ResourceError::InvalidLease);
        }
        let entry = self
            .entries
            .get(&token.resource)
            .ok_or(ResourceError::InvalidLease)?;
        entry.data.as_deref().ok_or(ResourceError::NotReady)
    }
    pub fn clear(&mut self) {
        self.entries.clear();
        self.active.clear();
        self.used = 0;
        self.revision = self.revision.saturating_add(1);
    }
    pub fn lease(&mut self, id: &ResourceId) -> Result<LeaseId, ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        if !matches!(
            entry.state,
            ResourceState::Registered | ResourceState::Ready
        ) {
            return Err(ResourceError::NotReady);
        }
        self.lease_reference(id)
    }
    /// Pin a declared project reference during degraded restore; reading still requires Ready data.
    pub fn lease_reference(&mut self, id: &ResourceId) -> Result<LeaseId, ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        let count = entry.leases.checked_add(1).ok_or(ResourceError::Overflow)?;
        let sequence = self
            .next_lease
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
        let token = LeaseId {
            manager: self.identity,
            resource: id.clone(),
            generation: entry.generation,
            sequence,
        };
        self.entries.get_mut(id).expect("validated").leases = count;
        self.active.insert(sequence, token.clone());
        self.next_lease = sequence;
        Ok(token)
    }
    pub fn release_lease(&mut self, token: &LeaseId) -> Result<(), ResourceError> {
        let entry = self
            .entries
            .get(&token.resource)
            .ok_or(ResourceError::InvalidLease)?;
        if entry.generation != token.generation
            || entry.leases == 0
            || self.active.get(&token.sequence) != Some(token)
        {
            return Err(ResourceError::InvalidLease);
        }
        self.active.remove(&token.sequence);
        self.entries
            .get_mut(&token.resource)
            .expect("validated")
            .leases -= 1;
        Ok(())
    }
    pub fn unregister(&mut self, id: &ResourceId) -> Result<(), ResourceError> {
        let entry = self.entries.get(id).ok_or(ResourceError::Unknown)?;
        if entry.leases > 0 {
            return Err(ResourceError::StillLeased);
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or(ResourceError::Overflow)?;
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
    fn id(s: &str) -> ResourceId {
        ResourceId::new(s).unwrap()
    }
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
        assert_eq!(
            r.register(id("large"), 11),
            Err(ResourceError::BudgetExceeded)
        );
        assert_eq!(r.used_bytes(), 0);
        assert_eq!(r.revision(), 0);
    }
}
