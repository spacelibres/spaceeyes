---
name: bevy-ecs-queries
description: Use when writing `Query<D, F>` with `With`/`Without`/`Or`, detecting `Changed<T>`/`Added<T>`, parallelising with `par_iter_mut`, building a query lens, or fixing Bevy 0.19 generic-query errors involving `IterQueryData` or `SingleEntityQueryData`.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: ecs
  bevy_version: "0.19"
---

# Bevy 0.19 — ECS Queries

## When to use this skill

- Reading or writing components from a system.
- Filtering by presence (`With`/`Without`), alternation (`Or`), or change detection (`Changed`/`Added`).
- Parallelising over a large entity set with `par_iter_mut`.
- Borrowing a subset of a query via a lens (`transmute_lens`).
- Compiler error mentioning `IterQueryData` or `SingleEntityQueryData` after upgrading to 0.19.

## Canonical pattern

```rust
use bevy::prelude::*;

#[derive(Component, Default)]
struct Health(f32);

#[derive(Component, Default)]
struct Velocity(Vec3);

#[derive(Component)]
struct Player;

#[derive(Component)]
struct Enemy;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Update, (
            move_things,
            on_health_changed,
            damage_visible_enemies,
            integrate_in_parallel,
        ))
        .run();
}

// Sequential iteration. `&` for read, `&mut` for write.
fn move_things(time: Res<Time>, mut q: Query<(&Velocity, &mut Transform)>) {
    let dt = time.delta_secs();
    for (vel, mut tf) in &mut q {
        tf.translation += vel.0 * dt;
    }
}

// Change detection. `Changed<T>` triggers on insert OR mutation.
// `Added<T>` triggers only on insert.
fn on_health_changed(q: Query<(Entity, &Health), Changed<Health>>) {
    for (entity, hp) in &q {
        info!("entity {:?} now has {} hp", entity, hp.0);
    }
}

// Combined filters. `With`/`Without` constrain entities;
// `Or<(...)>` alternates over filters (not components).
fn damage_visible_enemies(
    mut q: Query<&mut Health, (With<Enemy>, Without<Player>, Or<(Added<Enemy>, Changed<Transform>)>)>,
) {
    for mut hp in &mut q {
        hp.0 -= 1.0;
    }
}

// Parallel iteration. Use when N is large (>10k) and per-entity work is non-trivial.
// Cannot use `Commands` or external mutable state — task pool runs items in parallel.
fn integrate_in_parallel(mut q: Query<(&Velocity, &mut Transform)>) {
    q.par_iter_mut().for_each(|(vel, mut tf)| {
        tf.translation += vel.0 * 0.016;
    });
}

// Query lens: temporarily view a query as a narrower one. Useful for
// passing a stricter query into a helper without re-binding the system's
// SystemParam list.
#[allow(dead_code)]
fn use_lens(mut q: Query<(&mut Transform, &Velocity)>) {
    // Read-only narrowed view of just the Transform column.
    let mut lens = q.transmute_lens::<&Transform>();
    let _read_only: Query<&Transform> = lens.query();
}
```

## Bevy 0.19 gotchas

- **Nested query access added bounds in 0.19.** Generic mutable iteration usually needs `D: IterQueryData`; single-entity access, query transmutation/join, traversal, and sorting may need `D: SingleEntityQueryData`. Read-only iteration retains the broader bounds.
- **Non-iterable query data uses lending iteration.** Keep `D: QueryData`, call `let mut iter = query.iter_mut()`, then repeatedly call `iter.fetch_next()` when a nested query item may access several entities.
- **`EntityMut::get_components_mut::<(&mut A, &mut B)>()`** is the safe way to grab two `&mut`s out of one entity and now carries a `SingleEntityQueryData` bound. It returns `Result`; do not reach for unchecked aliasing.
- **`Query::get`/`get_mut` returns `Result`, not `Option`**. The error type carries the entity, so don't swallow it with `.ok()` if you actually need to know why a lookup missed.
- **`Or<(With<A>, With<B>)>`** — `Or` alternates over **filters**, not raw component types. `Or<(A, B)>` does not compile.
- **`Changed`/`Added` are tick-based.** They compare against the system's last run, so ordinary run conditions do not lose an intervening change. They report mutation, not semantic inequality; use observers/messages when every occurrence or old/new value matters.
- **Don't pair `par_iter_mut` with `Commands`.** Spawn/despawn from a sequential system that consumes a `Resource` queue written by the parallel one.

## See also

- `bevy-ecs-components` — declaring the components queried here.
- `bevy-ecs-systems` — using queries inside `SystemParam` and run conditions.
- `bevy-migration-0-17-to-0-18` — `EntityMut::get_components_mut` and tick-type move.
- `bevy-migration-0-18-to-0-19` — nested-query trait bounds and resources in queries.
