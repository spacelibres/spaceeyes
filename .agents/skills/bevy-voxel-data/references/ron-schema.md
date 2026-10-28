# Block Catalog RON Schema

Full field reference for `assets/blocks.ron`. See also
[palette.md](palette.md) for the Rust types this deserializes into.

---

## Full Example

```ron
// assets/blocks.ron
(
    blocks: [
        (
            id: "core:air",
            name: "Air",
            visibility: Empty,
            // faces omitted — no textures needed for empty blocks
        ),
        (
            id: "core:grass",
            name: "Grass",
            visibility: Opaque,
            faces: (
                top:    "textures/grass_top.png",
                bottom: "textures/dirt.png",
                side:   "textures/grass_side.png",
                // `all` is unused when individual face keys are present
            ),
        ),
        (
            id: "core:stone",
            name: "Stone",
            visibility: Opaque,
            faces: ( all: "textures/stone.png" ),
        ),
        (
            id: "core:glass",
            name: "Glass",
            visibility: Translucent,
            faces: ( all: "textures/glass.png" ),
            flags: ["no_ao"],
        ),
        (
            id: "core:water",
            name: "Water",
            visibility: Translucent,
            faces: (
                top:  "textures/water_top.png",
                side: "textures/water_side.png",
                all:  "textures/water_side.png",  // fallback if top/bottom absent
            ),
            flags: ["no_ao", "animated"],
        ),
    ],
)
```

---

## Field Reference

### `BlockEntry` (each element of `blocks`)

| Field        | Type              | Required | Default   | Description |
|---|---|---|---|---|
| `id`         | `StableBlockId`   | yes      | —         | Immutable namespaced serialization identity, for example `core:stone`. |
| `name`       | `String`          | yes      | —         | Presentation/debug name; not a persistence key. |
| `visibility` | `Visibility` enum | yes      | —         | Controls face culling and draw-call batching. |
| `faces`      | `BlockFaces`      | no       | `None`    | Texture paths per face. Omit for fully invisible blocks (air). |
| `flags`      | `Vec<String>`     | no       | `[]`      | Freeform tags consumed by game logic; serde defaults to empty vec. |

### `Visibility` enum

| Variant       | Effect |
|---|---|
| `Empty`       | Block occupies no visual space; skip all face quads. |
| `Opaque`      | All six faces cull neighbours; contributes to ambient-occlusion. |
| `Translucent` | Faces are kept even when neighbours are opaque; requires alpha blend. |

### `BlockFaces`

All four fields are `Option<String>` with `#[serde(default)]`.

| Key      | Maps to face slots |
|---|---|
| `top`    | `+Y` (slot 4 in block-mesh order) |
| `bottom` | `-Y` (slot 1) |
| `side`   | `-X`, `-Z`, `+X`, `+Z` (slots 0, 2, 3, 5) |
| `all`    | Fallback when a specific key is absent. |

Resolution priority — **horizontal faces** (`side` slots 0, 2, 3, 5): specific key → `side` → `all` → tile 0.
Resolution priority — **vertical faces** (`top` slot 4, `bottom` slot 1): specific key → `all` → tile 0 (`side` is not a fallback for vertical faces).

---

## Serde Defaults and Parser Notes

- Use `#[serde(default)]` on `faces` and `flags` so blocks that omit them
  still deserialize correctly.
- RON is strict about trailing commas — add them; omit them; both are valid.
- Reject duplicate `id` values while building the catalog. Duplicate display
  names are harmless if the UI permits them.
- Catalog order may determine dense runtime `BlockId` values for that process,
  but order is not stable identity. Saves should store stable IDs directly or
  include a save-local palette of stable IDs, then remap into the current dense
  runtime palette. Reordering catalog entries must not corrupt old saves.
- `visibility` has no serde default; omitting it is a parse error. This is
  intentional: forgetting `Empty` on air would produce a block that fully
  occludes its neighbours.
