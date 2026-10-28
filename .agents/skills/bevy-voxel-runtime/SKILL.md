---
name: bevy-voxel-runtime
description: "Use when turning voxel edits into production Bevy 0.19 remesh work with `AsyncComputeTaskPool`, `Mesh3d`, and Rapier `Collider`: dirty/halo fan-out, revision tokens, stale-result rejection, coalescing, priority, bounded uploads, or atomic swaps."
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: voxel-runtime
  bevy_version: "0.19"
---

# Bevy 0.19 — production voxel runtime

## When to use this skill

- Edits can cross section boundaries or affect AO/lighting halo samples.
- Background remesh results can arrive after newer edits or unload/reload.
- Mesh/collider uploads, queue growth, or visible-section latency cause frame spikes.
- A prototype currently spawns one `AsyncComputeTaskPool` task per edit.

Use this skill after the block catalog and mesher are correct. It owns the runtime
contract between edits, background meshing, and main-thread presentation. A worker
result is only a proposal: the world revision must still accept it.

## Canonical pattern

```rust
use bevy::prelude::*;
use std::collections::{BinaryHeap, HashMap, VecDeque};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
struct SectionCoord { x: i32, y: i32, z: i32 }

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct WorkToken {
    coord: SectionCoord,
    revision: u64,
    epoch: u64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum WorkState {
    #[default]
    Idle,
    Queued,
    Running,
    RunningAndDirty,
    Ready,
}

#[derive(Resource, Default)]
struct RemeshRuntime {
    state: HashMap<SectionCoord, WorkState>,
    latest: HashMap<SectionCoord, WorkToken>,
    queued: BinaryHeap<PriorityEntry>,
    completed: VecDeque<MeshResult>,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct PriorityEntry {
    // Include the token or queue generation so obsolete heap entries can be skipped.
    priority: i64,
    queue_generation: u64,
    token: WorkToken,
}

struct MeshResult {
    token: WorkToken,
    mesh: MeshPayload,
    collider: ColliderPayload,
}

struct MeshPayload;
struct ColliderPayload;
```

The worker input must own an immutable snapshot of the section plus required halo.
Do not hold ECS borrows, asset borrows, or world locks across background work.

## Gotchas and invariants

1. Derive dirty fan-out from the mesher's actual read stencil. An interior edit
   dirties one section; a face-boundary edit also dirties the orthogonal neighbour.
   Ambient occlusion, smooth lighting, or other halo reads can require edge/corner
   neighbours too.
2. Give every section a monotonic content revision and a lifecycle epoch. Capture
   both in each job and result. Never identify validity by coordinates alone.
3. Keep at most one queued/running/pending-result intent per section. An edit during
   a running job marks that section dirty again; it does not spawn an equivalent job.
4. Bound worker starts, completed-result storage, mesh/collider applications, upload
   bytes, and apply time. A thread pool is not backpressure.
5. Re-check revision and epoch immediately before replacing presentation state.
   Reject stale results and count them; never let an old task overwrite a new edit.
6. Swap the visible mesh and matching collider as one accepted revision. Do not show
   geometry from revision N while collision still represents N-1.

## Runtime flow

```text
edit -> compute dirty footprint -> bump revisions -> coalesce queue intent
     -> priority scheduler -> bounded task starts -> completed-result queue
     -> validate token -> bounded main-thread upload -> mesh+collider swap
                                      \-> stale reject + metric
```

- Run edit collection and dirty marking in an explicitly ordered simulation set.
- Snapshot only when a worker slot is available; otherwise queued edits continue to
  coalesce without allocating task inputs.
- Prioritise visible collision-critical sections, then visible near-to-far sections,
  then off-screen work. Add age so distant work cannot starve forever.
- Apply uploads in `Update`/`PostUpdate` or an exclusive system with a measured
  per-frame budget. GPU asset creation is main-world work, not worker work.
- If a task finishes after unload/reload, the epoch mismatch rejects it even when
  the new section happens to have the same revision number.

## Choose the relevant deep dive

| Problem | Read |
|---|---|
| Dirty footprints, halo semantics, revision and lifecycle tokens | [Dirtying and revisions](references/dirtying-and-revisions.md) |
| Coalescing, priority heaps, task ownership, and queue bounds | [Queues and priorities](references/queues-and-priorities.md) |
| Stale rejection, atomic presentation swaps, and diagnostics | [Apply and telemetry](references/apply-and-telemetry.md) |

## Production review checklist

- A boundary edit remeshes every section whose mesh reads the changed sample.
- A same-coordinate unload/reload invalidates earlier results.
- A burst of 1,000 edits to one section creates bounded work, not 1,000 tasks.
- A stale result cannot mutate mesh, collider, revision, or readiness state.
- Catch-up work respects both count and byte/time budgets.
- Visible collision holes outrank distant cosmetic work without permanent starvation.
- Queue depth, age, task latency, stale count, coalesced count, upload bytes, and
  accepted revision are observable in a representative build.

## See also

- [`bevy-voxel-data`](../bevy-voxel-data/SKILL.md) — stable serialized block IDs and dense runtime palettes.
- [`bevy-voxel-pipeline`](../bevy-voxel-pipeline/SKILL.md) — mesh generation and `block-mesh-rs`.
- [`bevy-diagnostics-profiling`](../bevy-diagnostics-profiling/SKILL.md) — diagnostics, spans, and platform budgets.
- [`bevy-physics`](../bevy-physics/SKILL.md) — collider ownership and physics scheduling.
