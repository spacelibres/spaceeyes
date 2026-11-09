---
name: bevy-voxel-data
description: Use when defining Bevy 0.19 voxel blocks with immutable serialized IDs in RON, mapping them to a dense runtime `BlockId` palette, choosing chunk storage with explicit world extents, baking a KTX2 atlas, or binding face tiles through `StandardMaterial`.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: voxel
  bevy_version: "0.19"
---

# Bevy 0.19 — Voxel data (RON, palette, KTX2 atlas)

## When to use this skill

- Defining a moddable block catalog in a text format authors can edit.
- Building a runtime palette keyed by `BlockId` (`u16`/`u32`) for fast lookup during meshing.
- Packing per-block textures into a single atlas so all chunks can share one material.
- Switching the atlas to KTX2 for GPU-friendly compressed delivery.
- Choosing a runtime chunk storage format (flat array, RLE, palette compression, hybrid).
- Optimising procedural world generation: extremity bound checking, noise upsampling, noise caching, cross-biome noise sharing.
- Surveying the Rust/Bevy voxel-crate ecosystem and its current gaps before reaching for a dependency.

## Canonical end-to-end flow

**1. Define blocks in RON** (`assets/blocks.ron`). `id` is the immutable,
serialized identity; `name` is presentation text and may change:

```ron
(
    blocks: [
        ( id: "core:air", name: "Air", visibility: Empty ),
        ( id: "core:grass", name: "Grass", visibility: Opaque,
          faces: ( top: "textures/grass_top.png",
                   bottom: "textures/dirt.png",
                   side: "textures/grass_side.png" ) ),
        ( id: "core:stone", name: "Stone", visibility: Opaque,
          faces: ( all: "textures/stone.png" ) ),
    ],
)
```

**2. Core Rust types** — `BlockCatalog` is a Bevy `Asset`; `Palette` is a `Resource`:

```rust
pub type BlockId = u16;

#[derive(Debug, Deserialize, Clone, Eq, Hash, PartialEq)]
#[serde(transparent)]
pub struct StableBlockId(pub String);

#[derive(Debug, Deserialize, Asset, TypePath)]
pub struct BlockCatalog { pub blocks: Vec<BlockDef> }

#[derive(Resource, Default)]
pub struct Palette {
    pub by_id: Vec<PaletteEntry>, // dense, process-local BlockId
    pub by_stable_id: HashMap<StableBlockId, BlockId>,
}

#[derive(Clone)]
pub struct PaletteEntry {
    pub stable_id:  StableBlockId,
    pub name:       String,
    pub visibility: Visibility,
    /// Atlas tile per face: [−X, −Y, −Z, +X, +Y, +Z] (block-mesh order).
    pub face_tiles: [u16; 6],
}
```

**3. Build the palette** — validate unique stable IDs, walk the catalog, look up
each face path in the `AtlasIndex`, and assign dense runtime `BlockId` values.
Catalog order may influence this runtime layout, but it is never the persistence
contract. Saves and network formats store stable IDs directly or carry their own
stable-ID palette and remap it when loading.

**4. Bind the atlas** to `StandardMaterial.base_color_texture`; compute
per-vertex UVs as `tile_x = tile_index % atlas_cols` during the meshing pass.

## Topics

| Topic | Reference |
|---|---|
| Full RON schema, all fields, serde defaults, parser notes | [references/ron-schema.md](references/ron-schema.md) |
| `BlockDef` / `BlockFaces` / `Visibility` types, `build_palette` in full, `face_tiles` slot convention | [references/palette.md](references/palette.md) |
| KTX2 packing, tile-size budgets, padding for mip safety, BC7/ETC2/ASTC per platform | [references/ktx2-atlas.md](references/ktx2-atlas.md) |
| `StandardMaterial` binding, UV formula, per-vertex emission, sampler config, alpha modes | [references/atlas-binding.md](references/atlas-binding.md) |
| Runtime chunk storage formats — flat array, RLE, palette compression, hybrid — with RAM estimates | [references/storage-formats.md](references/storage-formats.md) |
| Procedural generation patterns — noise upsampling, biome sharing, extremity bounds, caching | [references/generation.md](references/generation.md) |
| Rust/Bevy voxel-crate ecosystem survey (`block-mesh`, `building-blocks`, `feldspar`, …) | [references/ecosystem.md](references/ecosystem.md) |

## Gotchas

- **KTX2 is opt-in.** Bevy supports KTX2 via the `ktx2` Cargo feature (on by
  default in the `3d` bundle). For trimmed WASM builds add `ktx2` and `zstd`
  explicitly. Use BC7 (desktop) or ETC2/ASTC (mobile) — see
  [references/ktx2-atlas.md](references/ktx2-atlas.md).
- **Runtime `BlockId` is not persistent identity.** It is a dense index rebuilt
  for the current catalog. Persist immutable namespaced IDs such as `core:stone`,
  validate duplicates, and map them to the current runtime palette on load.
- **Texture bleeding at mip levels ≥ 1.** Add 2-pixel padding around each
  tile, or switch to a texture array with `clamp_to_edge` per slice. Details
  in [references/ktx2-atlas.md](references/ktx2-atlas.md) and
  [references/atlas-binding.md](references/atlas-binding.md).
- **`Translucent` blocks need a separate draw call.** Use
  `AlphaMode::Blend` on a second material and a separate mesh batch per chunk —
  translucent quads cannot be merged with opaque ones.
- **Don't bake the atlas at runtime in shipped builds.** Run the bake script at
  content-build time; commit the `.ktx2` + JSON index; load both at startup.

## See also

- `bevy-voxel-pipeline` — the meshing step that consumes `face_tiles`.
- [`bevy-voxel-runtime`](../bevy-voxel-runtime/SKILL.md) — edit dirtying,
  revisions, bounded remeshing, and mesh/collider application.
- [`bevy-save-load`](../bevy-save-load/SKILL.md) — versioned persistence and stable-ID migration.
- `bevy-custom-assets` — implementing the RON catalog loader.
- `bevy-pbr-materials` — wiring the atlas into `StandardMaterial`.
