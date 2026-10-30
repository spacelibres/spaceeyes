use crate::{AssetKind, Core, CoreError};
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentSpec {
    pub asset_id: String,
    pub frame: String,
    pub intensity: f32,
    #[serde(default)]
    pub lod: Option<EnvironmentLod>,
}
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentLod {
    pub tile_size: u32,
    pub border: u32,
    pub levels: Vec<EnvironmentLevel>,
    pub diffuse_asset_id: String,
    pub specular_asset_id: String,
    pub exposure_ev: f32,
    pub black_level: f32,
    pub ibl_intensity: f32,
}
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentLevel {
    pub level: u32,
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<EnvironmentTile>,
}
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnvironmentTile {
    pub x: u32,
    pub y: u32,
    pub asset_id: String,
}
#[derive(Debug, Clone)]
pub(crate) struct EnvironmentLayer {
    pub owner: String,
    pub spec: EnvironmentSpec,
    pub revision: u64,
}
impl Core {
    pub fn environment_revision(&self) -> Option<u64> {
        self.environment.as_ref().map(|layer| layer.revision)
    }
    pub fn environment_spec(&self) -> Option<&EnvironmentSpec> {
        self.environment.as_ref().map(|layer| &layer.spec)
    }
    pub fn set_environment(
        &mut self,
        plugin: &str,
        session: &str,
        spec: Option<EnvironmentSpec>,
    ) -> Result<(), CoreError> {
        if !self.authorize(session, plugin)?.visual_control {
            return Err(CoreError::PermissionDenied);
        }
        if self
            .environment
            .as_ref()
            .is_some_and(|v| v.owner != session)
        {
            return Err(CoreError::WrongOwner);
        }
        if let Some(ref s) = spec {
            if s.frame != "ICRF" || !s.intensity.is_finite() || !(0.0..=4.0).contains(&s.intensity)
            {
                return Err(CoreError::InvalidVisual);
            }
            if self
                .assets
                .get(&s.asset_id)
                .ok_or(CoreError::UnknownAsset)?
                .kind
                != AssetKind::Texture
            {
                return Err(CoreError::InvalidAsset);
            }
        }
        if let Some(lod) = spec.as_ref().and_then(|s| s.lod.as_ref()) {
            if lod.tile_size != 256
                || lod.border != 2
                || lod.levels.len() != 7
                || !lod.exposure_ev.is_finite()
                || !(-6.0..=6.0).contains(&lod.exposure_ev)
                || !lod.black_level.is_finite()
                || !(0.0..=0.02).contains(&lod.black_level)
                || !lod.ibl_intensity.is_finite()
                || !(0.0..=2.0).contains(&lod.ibl_intensity)
            {
                return Err(CoreError::InvalidVisual);
            }
            let mut ids = vec![&lod.diffuse_asset_id, &lod.specular_asset_id];
            for (i, l) in lod.levels.iter().enumerate() {
                let (w, h) = (128u32 << i, 64u32 << i);
                if l.level != i as u32
                    || l.width != w
                    || l.height != h
                    || l.tiles.len() != (w.div_ceil(256) * h.div_ceil(256)) as usize
                {
                    return Err(CoreError::InvalidVisual);
                }
                let mut seen = std::collections::HashSet::new();
                for t in &l.tiles {
                    if t.x >= w.div_ceil(256) || t.y >= h.div_ceil(256) || !seen.insert((t.x, t.y))
                    {
                        return Err(CoreError::InvalidVisual);
                    }
                    ids.push(&t.asset_id);
                }
            }
            if ids.len() > 1026 {
                return Err(CoreError::CapacityExceeded);
            }
            if spec.as_ref().unwrap().asset_id != lod.levels[0].tiles[0].asset_id {
                return Err(CoreError::InvalidVisual);
            }
            for id in ids {
                if self.assets.get(id).ok_or(CoreError::UnknownAsset)?.kind != AssetKind::Texture {
                    return Err(CoreError::InvalidAsset);
                }
            }
        }
        let next_revision = self
            .environment_revision
            .checked_add(1)
            .ok_or(CoreError::CapacityExceeded)?;
        self.environment_revision = next_revision;
        self.environment_status =
            serde_json::json!({"phase":if spec.is_some(){"pending"}else{"disabled"}});
        self.environment = spec.map(|spec| EnvironmentLayer {
            owner: session.into(),
            spec,
            revision: self.environment_revision,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn environment_ownership_validation_and_release_are_atomic() {
        let mut core = Core::default();
        for s in ["a", "b"] {
            core.open_session_with_permissions(
                s,
                s,
                crate::SessionPermissions {
                    visual_control: true,
                    ..Default::default()
                },
            )
            .unwrap();
        }
        core.register_asset(
            "sky",
            crate::AssetDescriptor {
                kind: AssetKind::Texture,
                path: "sky.webp".into(),
            },
        )
        .unwrap();
        let spec = || EnvironmentSpec {
            asset_id: "sky".into(),
            frame: "ICRF".into(),
            intensity: 1.,
            lod: None,
        };
        core.set_environment("a", "a", Some(spec())).unwrap();
        assert_eq!(
            core.set_environment("b", "b", Some(spec())),
            Err(CoreError::WrongOwner)
        );
        let mut bad = spec();
        bad.intensity = f32::NAN;
        assert_eq!(
            core.set_environment("a", "a", Some(bad)),
            Err(CoreError::InvalidVisual)
        );
        assert_eq!(core.environment_spec().unwrap().intensity, 1.);
        core.release_session("a");
        assert!(core.environment_spec().is_none());
        assert_eq!(core.environment_status["phase"], "disabled");
    }
}
