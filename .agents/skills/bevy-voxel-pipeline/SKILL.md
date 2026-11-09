---
name: bevy-voxel-pipeline
description: Use when meshing voxel chunks with `block-mesh-rs` (`greedy_quads` / `visible_block_faces`), translating a `GreedyQuadsBuffer` into a Bevy 0.19 `Mesh` via `try_insert_attribute`, choosing greedy versus simple meshing, or implementing the worker-side meshing function consumed by a bounded voxel runtime.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: voxel
  bevy_version: "0.19"
---

# Bevy 0.19 — Voxel meshing pipeline

## When to use this skill

- Building a Minecraft-style voxel world with chunked meshing.
- Choosing between `greedy_quads` (fewer, larger quads — best for static terrain) and `visible_block_faces` (one quad per face — best for fast remesh on edits).
- Wiring `block-mesh-rs` output into a Bevy 0.19 `Mesh`.
- Implementing a pure worker-side mesh build for `bevy-voxel-runtime` to schedule.

## Canonical pattern

```rust
use bevy::asset::RenderAssetUsages;
use bevy::mesh::{Indices, PrimitiveTopology};
use bevy::prelude::*;
use block_mesh::ndshape::{ConstShape, ConstShape3u32};
use block_mesh::{
    greedy_quads, GreedyQuadsBuffer, MergeVoxel, Voxel, VoxelVisibility,
    RIGHT_HANDED_Y_UP_CONFIG,
};

// 18^3 — the standard "chunk plus padding" block-mesh expects.
// Each axis gets 1 cell of padding on each side so neighbour lookups are
// in-bounds. The user-visible chunk is 16^3.
type ChunkShape = ConstShape3u32<18, 18, 18>;

#[derive(Clone, Copy, Eq, PartialEq, Default)]
pub struct BlockId(pub u16);

impl Voxel for BlockId {
    fn get_visibility(&self) -> VoxelVisibility {
        if self.0 == 0 {
            VoxelVisibility::Empty
        } else {
            VoxelVisibility::Opaque
        }
    }
}

impl MergeVoxel for BlockId {
    type MergeValue = u16;
    fn merge_value(&self) -> Self::MergeValue { self.0 }
}

/// Build a Bevy 0.19 Mesh from a padded chunk of blocks.
/// Returns `None` for an entirely empty chunk so callers can skip spawning.
pub fn mesh_chunk(blocks: &[BlockId]) -> Option<Mesh> {
    assert_eq!(blocks.len(), ChunkShape::SIZE as usize);

    let mut buffer = GreedyQuadsBuffer::new(blocks.len());
    greedy_quads(
        blocks,
        &ChunkShape {},
        [0; 3],
        [17, 17, 17],
        &RIGHT_HANDED_Y_UP_CONFIG.faces,
        &mut buffer,
    );

    if buffer.quads.num_quads() == 0 {
        return None;
    }

    let num_indices = buffer.quads.num_quads() * 6;
    let num_vertices = buffer.quads.num_quads() * 4;
    let mut indices = Vec::with_capacity(num_indices);
    let mut positions = Vec::with_capacity(num_vertices);
    let mut normals = Vec::with_capacity(num_vertices);

    for (group, face) in buffer.quads.groups.iter().zip(RIGHT_HANDED_Y_UP_CONFIG.faces.iter()) {
        for quad in group.iter() {
            indices.extend_from_slice(&face.quad_mesh_indices(positions.len() as u32));
            positions.extend_from_slice(&face.quad_mesh_positions(quad, 1.0));
            normals.extend_from_slice(&face.quad_mesh_normals());
        }
    }

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.try_insert_attribute(Mesh::ATTRIBUTE_POSITION, positions).ok()?;
    mesh.try_insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals).ok()?;
    mesh.insert_indices(Indices::U32(indices));
    Some(mesh)
}
```

## Worker primitive only — not a production edit scheduler

The following shows task ownership and non-blocking completion polling. It deliberately
does **not** apply the result. A production edit-heavy game must first validate the
section revision/lifecycle token, coalesce duplicate work, and respect bounded worker,
result, upload, and collider budgets. Read `bevy-voxel-runtime` before wiring this into
a world.

```rust
use bevy::prelude::*;
use bevy::tasks::{futures::check_ready, AsyncComputeTaskPool, Task};

#[derive(Clone, Copy)]
struct MeshToken {
    section: IVec3,
    revision: u64,
    epoch: u64,
}

struct MeshBuild {
    token: MeshToken,
    mesh: Option<Mesh>,
}

#[derive(Component)]
struct MeshTask(Task<MeshBuild>);

#[derive(Resource, Default)]
struct CompletedMeshes(Vec<MeshBuild>);

# fn _kick(mut commands: Commands) {
let pool = AsyncComputeTaskPool::get();
let blocks = vec![crate::BlockId::default(); 18 * 18 * 18]; // replace from chunk store
let token = MeshToken { section: IVec3::ZERO, revision: 7, epoch: 2 };
let task = pool.spawn(async move {
    MeshBuild { token, mesh: crate::mesh_chunk(&blocks) }
});
commands.spawn(MeshTask(task));
# }

# fn _poll(mut commands: Commands, mut completed: ResMut<CompletedMeshes>, mut q: Query<(Entity, &mut MeshTask)>) {
for (entity, mut task) in &mut q {
    if let Some(result) = check_ready(&mut task.0) {
        commands.entity(entity).remove::<MeshTask>();
        completed.0.push(result); // validate token in the bounded apply stage
    }
}
# }
```

## Gotchas

- **Padding is non-optional.** `block-mesh` needs one cell of padding on each axis so cross-chunk neighbour visibility computes correctly. A "16-cube" chunk is stored as 18×18×18; edits in a chunk also touch the padding of its six neighbours.
- **Greedy vs simple.** The crate's included spherical-input benchmark reports roughly one third as many quads for `greedy_quads` at about three times the meshing time. Re-benchmark your block distribution; simple meshing can suit edit-heavy chunks while greedy meshing often suits stable terrain.
- **UVs are not free.** `block-mesh` doesn't emit UVs — you compute them yourself from quad face direction and block ID. A texture atlas + per-quad offset is the standard approach (see `bevy-voxel-data`).
- **`block-mesh-rs` is on Bevy-independent crate 0.2.0** (last updated 2022). It depends on `ilattice` and `ndshape`, both pure-Rust. Compatible with Bevy 0.19 by virtue of not depending on Bevy at all.
- **Don't reach for `par_iter` inside a single chunk mesh** — block-mesh is already fast. The parallelism wins are across chunks, not within one. Spawn N chunk-mesh tasks on `AsyncComputeTaskPool`.
- **A task pool is not a scheduler.** Never spawn one task per edit or apply a result
  by coordinate alone. Use `bevy-voxel-runtime` for dirty fan-out, revisions, stale
  rejection, coalescing, priority, backpressure, and atomic mesh/collider swaps.
- **`try_insert_attribute` returns `Result<(), MeshAccessError>`** in Bevy 0.19. `ExtractedToRenderWorld` cannot occur for a freshly constructed mesh, but handle or propagate the result so later changes to mesh ownership stay safe.
- **`RenderAssetUsages` lives in `bevy::asset`** (re-exported from `bevy::render::render_asset` privately). The public re-export is `bevy::asset::RenderAssetUsages`.

## See also

- [`bevy-voxel-data`](../bevy-voxel-data/SKILL.md) — stable block IDs, dense palettes, and atlas data.
- [`bevy-voxel-runtime`](../bevy-voxel-runtime/SKILL.md) — production scheduling,
  revision validation, bounded uploads, collider swaps, and telemetry.
- [`bevy-assets`](../bevy-assets/SKILL.md) — loading chunk data and managing mesh handles.
