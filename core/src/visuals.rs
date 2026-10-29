use crate::{Core, CoreError, valid_id};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AssetKind {
    Model,
    Texture,
}

#[derive(Debug, Clone)]
pub struct AssetDescriptor {
    pub kind: AssetKind,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum VisualSpec {
    Model {
        asset_id: String,
        #[serde(default)]
        scene: u32,
        scale_km_per_unit: f64,
    },
    Sphere {
        #[serde(default)]
        texture_asset: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct VisualAssignment {
    pub revision: u64,
    pub spec: VisualSpec,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VisualPhase {
    Pending,
    Loading,
    Ready,
    Failed,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VisualStatus {
    #[serde(serialize_with = "revision_string")]
    pub revision: u64,
    pub phase: VisualPhase,
    pub detail: Option<String>,
}

fn revision_string<S: serde::Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&value.to_string())
}

impl AssetDescriptor {
    fn valid(&self) -> bool {
        let path = &self.path;
        if path.is_empty()
            || path.len() > 512
            || path.starts_with('/')
            || !path
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"/._-".contains(&c))
            || path
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return false;
        }
        let lower = path.to_ascii_lowercase();
        let extensions: &[&str] = match self.kind {
            AssetKind::Model => &[".glb", ".gltf"],
            AssetKind::Texture => &[".png", ".jpg", ".jpeg", ".webp"],
        };
        extensions
            .iter()
            .any(|extension| lower.ends_with(extension))
    }
}

impl Core {
    pub fn owned_visual_status(
        &self,
        session: &str,
        plugin: &str,
        id: &str,
    ) -> Result<Option<&VisualStatus>, CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self.objects.get(id).ok_or(CoreError::UnknownObject)? != session {
            return Err(CoreError::WrongOwner);
        }
        self.visual_status(id)
    }
    /// Trusted host catalog only. Asset packs and their dependency graphs must be vetted before registration.
    pub fn register_asset(
        &mut self,
        id: &str,
        descriptor: AssetDescriptor,
    ) -> Result<(), CoreError> {
        if !valid_id(id) || id.contains('/') || !descriptor.valid() {
            return Err(CoreError::InvalidAsset);
        }
        if self.assets.contains_key(id) {
            return Err(CoreError::DuplicateAsset);
        }
        if self.assets.len() >= 4096 {
            return Err(CoreError::CapacityExceeded);
        }
        self.assets.insert(id.to_owned(), descriptor);
        Ok(())
    }

    pub fn asset_descriptor(&self, id: &str) -> Option<&AssetDescriptor> {
        self.assets.get(id)
    }
    pub fn visual_assignment(&self, id: &str) -> Option<&VisualAssignment> {
        self.visuals.get(id)
    }

    pub fn set_visual(
        &mut self,
        session: &str,
        plugin: &str,
        id: &str,
        spec: Option<VisualSpec>,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self.objects.get(id).ok_or(CoreError::UnknownObject)? != session {
            return Err(CoreError::WrongOwner);
        }
        let Some(spec) = spec else {
            self.visuals.remove(id);
            self.visual_statuses.remove(id);
            return Ok(());
        };
        let expected = match &spec {
            VisualSpec::Model {
                asset_id,
                scene,
                scale_km_per_unit,
            } => {
                if !scale_km_per_unit.is_finite() || *scale_km_per_unit <= 0.0 || *scene > 1023 {
                    return Err(CoreError::InvalidVisual);
                }
                Some((asset_id, AssetKind::Model))
            }
            VisualSpec::Sphere { texture_asset } => texture_asset
                .as_ref()
                .map(|asset| (asset, AssetKind::Texture)),
        };
        if let Some((asset_id, kind)) = expected {
            let descriptor = self.assets.get(asset_id).ok_or(CoreError::UnknownAsset)?;
            if descriptor.kind != kind {
                return Err(CoreError::InvalidVisual);
            }
        }
        let revision = self
            .next_visual_revision
            .checked_add(1)
            .ok_or(CoreError::CapacityExceeded)?;
        self.next_visual_revision = revision;
        self.visuals
            .insert(id.to_owned(), VisualAssignment { revision, spec });
        self.visual_statuses.insert(
            id.to_owned(),
            VisualStatus {
                revision,
                phase: VisualPhase::Pending,
                detail: None,
            },
        );
        Ok(())
    }

    pub fn visual_status(&self, id: &str) -> Result<Option<&VisualStatus>, CoreError> {
        if !self.objects.contains_key(id) {
            return Err(CoreError::UnknownObject);
        }
        Ok(self.visual_statuses.get(id))
    }

    /// Renderer-owned result; stale completions never update replacement objects.
    pub fn record_visual_status(
        &mut self,
        id: &str,
        revision: u64,
        phase: VisualPhase,
        detail: Option<String>,
    ) -> bool {
        if self
            .visuals
            .get(id)
            .is_none_or(|visual| visual.revision != revision)
        {
            return false;
        }
        self.visual_statuses.insert(
            id.to_owned(),
            VisualStatus {
                revision,
                phase,
                detail: detail.map(|text| text.chars().take(512).collect()),
            },
        );
        true
    }

    #[cfg(feature = "bevy-runtime")]
    pub(crate) fn suspend_visual(&mut self, id: &str, detail: String) {
        if let Some(revision) = self.visuals.get(id).map(|visual| visual.revision) {
            self.record_visual_status(id, revision, VisualPhase::Suspended, Some(detail));
        }
    }
}
