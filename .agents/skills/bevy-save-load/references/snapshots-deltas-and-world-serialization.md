# Snapshots, sparse deltas, and Bevy world serialization

## Full snapshot plus bounded delta log

Large editable worlds often need:

- a base snapshot identified by generation/content revision;
- ordered sparse operations carrying operation ID/sequence and base generation;
- periodic compaction into a new snapshot;
- an atomic head pointing to a complete snapshot plus its compatible delta range.

For voxel worlds, snapshot seed/generated regions plus explicit edited sections or
save-local palettes and sparse edits. Do not save a dense render-distance volume just
because it is resident. Delta operations must be deterministic and either idempotent
or protected against duplicate application.

Define recovery from a truncated/corrupt tail: validate each record framing/checksum,
apply through the last valid committed sequence, and report lost newest progress.
Never combine deltas from generation B with snapshot A merely because IDs happen to
parse.

Compaction writes a new generation beside the old one, validates it, atomically moves
the committed head, then eventually retires unreachable generations. A crash at every
step must leave at least one readable combination.

## When `DynamicWorldBuilder` helps

With Bevy's `bevy_world_serialization` feature, `DynamicWorldBuilder` can:

- extract selected entities;
- extract reflected resources;
- allow or deny component/resource types;
- build a `DynamicWorld` for reflection-driven serialization/spawning.

Start from `deny_all()`/explicit allowlists for a controlled snapshot. Default broad
reflection can accidentally include caches, handles, presentation state, or sensitive
runtime data as components evolve.

This is a good fit for editor-authored scenes, mod/tool interchange, test fixtures,
and internal snapshots whose producer/consumer versions move together. It is not by
itself a durable game-save strategy because:

- live `Entity` identity and cross-entity semantics need stable domain mapping;
- component type/field refactors change the reflected schema;
- migrations and unknown-type policy remain application responsibilities;
- storage commit, corruption framing, and recovery are outside ECS serialization;
- runtime-only components/resources still need deliberate exclusion/reconstruction.

## Safe hybrid

An explicit save envelope may contain a tightly filtered/versioned dynamic-world
section for modded or editor-defined content plus stable DTO sections for gameplay
progress. Record the type-registry/content version and migrate/test the hybrid as one
contract. On load, stage the dynamic world, validate allowed types and stable links,
then instantiate it only after the surrounding DTO passes.

Primary references:

- [Bevy world serialization module](https://docs.rs/bevy/0.19.0/bevy/world_serialization/index.html)
- [`DynamicWorldBuilder`](https://docs.rs/bevy/0.19.0/bevy/world_serialization/struct.DynamicWorldBuilder.html)
- [Bevy 0.19 world serialization example](https://github.com/bevyengine/bevy/blob/v0.19.0/examples/scene/world_serialization.rs)
