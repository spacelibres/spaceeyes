# Palette — Stable Identity and Dense Runtime IDs

Runtime lookup table from a dense `BlockId` to `PaletteEntry`, plus a reverse
map from immutable serialized identifiers. Dense IDs are an optimization for the
current process, not a save-file or network contract.
See [ron-schema.md](ron-schema.md) for the RON source and
[atlas-binding.md](atlas-binding.md) for how `face_tiles` feeds UV generation.

---

## Type Definitions

```rust
use bevy::prelude::*;
use bevy::reflect::TypePath;
use serde::Deserialize;
use std::collections::HashMap;

pub type BlockId = u16;

#[derive(Debug, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct StableBlockId(pub String);

#[derive(Debug, Deserialize, Clone, Copy, Default)]
pub enum Visibility { #[default] Empty, Translucent, Opaque }

#[derive(Debug, Deserialize, Clone, Default)]
pub struct BlockFaces {
    #[serde(default)] pub top:    Option<String>,
    #[serde(default)] pub bottom: Option<String>,
    #[serde(default)] pub side:   Option<String>,
    #[serde(default)] pub all:    Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BlockDef {
    pub id:         StableBlockId,
    pub name:       String,
    pub visibility: Visibility,
    #[serde(default)] pub faces: Option<BlockFaces>,
    #[serde(default)] pub flags: Vec<String>,
}

#[derive(Debug, Deserialize, Asset, TypePath)]
pub struct BlockCatalog {
    pub blocks: Vec<BlockDef>,
}

/// Compact runtime palette. `BlockId` values may change after catalog edits.
#[derive(Resource, Default)]
pub struct Palette {
    pub by_id: Vec<PaletteEntry>,
    pub by_stable_id: HashMap<StableBlockId, BlockId>,
}

#[derive(Clone)]
pub struct PaletteEntry {
    pub stable_id:  StableBlockId,
    pub name:       String,
    pub visibility: Visibility,
    /// Atlas tile index for each of the six face directions.
    /// Index ordering matches block-mesh-rs face order (see table below).
    pub face_tiles: [u16; 6],
}
```

---

## `face_tiles` Slot Convention

`face_tiles[i]` stores the atlas tile index for the face at that slot.
The ordering matches `block_mesh::OrientedBlockFace` in `block-mesh-rs`:

| Slot | Direction | `BlockFaces` key |
|---|---|---|
| 0    | `-X`      | `side`           |
| 1    | `-Y`      | `bottom`         |
| 2    | `-Z`      | `side`           |
| 3    | `+X`      | `side`           |
| 4    | `+Y`      | `top`            |
| 5    | `+Z`      | `side`           |

Keeping this in sync with the meshing skill (`bevy-voxel-pipeline`) is critical:
the mesher reads `face_tiles[face_index]` to write per-vertex UV data.

---

## `build_palette` — Full Implementation

Call this once after the `BlockCatalog` asset loads and the `AtlasIndex` is
populated. `AtlasIndex` maps texture asset paths to atlas tile indices (produced
by the KTX2 baking step — see [ktx2-atlas.md](ktx2-atlas.md)).

```rust
use bevy::prelude::*;
use std::collections::HashMap;

/// Loaded from the JSON sidecar alongside the KTX2 atlas.
#[derive(Resource, Default)]
pub struct AtlasIndex(pub HashMap<String, u16>);

pub fn build_palette(
    catalog: &BlockCatalog,
    atlas: &AtlasIndex,
    palette: &mut Palette,
) -> Result<(), String> {
    let mut by_id = Vec::with_capacity(catalog.blocks.len());
    let mut by_stable_id = HashMap::with_capacity(catalog.blocks.len());

    for (index, def) in catalog.blocks.iter().enumerate() {
        match def.id.0.split_once(':') {
            Some((namespace, key)) if !namespace.is_empty() && !key.is_empty() => {}
            _ => return Err(format!(
                "stable block id must be a non-empty namespace:key: {}",
                def.id.0,
            )),
        }
        let id = BlockId::try_from(index)
            .map_err(|_| "block catalog exceeds the u16 runtime palette".to_owned())?;
        if by_stable_id.insert(def.id.clone(), id).is_some() {
            return Err(format!("duplicate stable block id: {}", def.id.0));
        }
        let tile_of = |maybe: &Option<String>| -> u16 {
            maybe.as_ref()
                .and_then(|p| atlas.0.get(p).copied())
                .unwrap_or(0)   // tile 0 = "missing texture" sentinel
        };

        let face_tiles = match &def.faces {
            Some(f) => {
                let all  = tile_of(&f.all);
                let side = if f.side.is_some() { tile_of(&f.side)   } else { all };
                let top  = if f.top.is_some()  { tile_of(&f.top)    } else { all };
                let bot  = if f.bottom.is_some(){ tile_of(&f.bottom)} else { all };
                [
                    side, // 0 = -X
                    bot,  // 1 = -Y (bottom)
                    side, // 2 = -Z
                    side, // 3 = +X
                    top,  // 4 = +Y (top)
                    side, // 5 = +Z
                ]
            }
            None => [0; 6],
        };

        by_id.push(PaletteEntry {
            stable_id:  def.id.clone(),
            name:       def.name.clone(),
            visibility: def.visibility,
            face_tiles,
        });
    }

    // Publish only a fully validated palette.
    *palette = Palette { by_id, by_stable_id };
    Ok(())
}
```

Catalog order can still choose the dense layout because that keeps lookups and
meshing compact. It is safe to reorder only because persisted data never stores
these runtime values without a stable-ID translation table.

### Wiring in a system

```rust
fn on_catalog_loaded(
    catalog_assets: Res<Assets<BlockCatalog>>,
    catalog_handle: Res<CatalogHandle>,
    atlas:          Res<AtlasIndex>,
    mut palette:    ResMut<Palette>,
) {
    let Some(catalog) = catalog_assets.get(&catalog_handle.0) else { return };
    if let Err(error) = build_palette(catalog, &atlas, &mut palette) {
        error!(%error, "block catalog rejected");
    }
}
```

Run this system in `Update` gated on `AssetEvent<BlockCatalog>` or a
`State` transition — after both the catalog and atlas index are ready.

## Save and network boundary

Choose one of these formats:

- Store a stable ID per voxel. Simple, but usually too large.
- Store a save-local palette of stable IDs and bit-pack indices into that
  palette. On load, resolve every stable ID to the current runtime `BlockId`
  before expanding or remapping chunk data.

Define a missing-block policy. Keeping an explicit `core:missing` entry preserves
unknown modded blocks for repair; silently mapping unknown IDs to air destroys
information and may change collision or progression state.
