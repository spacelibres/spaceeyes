---
name: bevy-ecs-components
description: Use when defining `#[derive(Component)]`, declaring required components with `#[require(...)]`, writing observers with `On<E>`, choosing Table versus SparseSet storage, registering `on_add`/`on_discard`/`on_remove` hooks, or migrating `Replace` lifecycle events in Bevy 0.19.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: ecs
  bevy_version: "0.19"
---

# Bevy 0.19 — ECS Components

## When to use this skill

- Defining a new `Component` for game state.
- Bundling components via `#[require(...)]` (the modern replacement for "bundles").
- Reacting to component lifecycle: spawning, despawning, inserting, removing.
- Observers — reacting to entity-targeted events with `On<E>`.
- Choosing storage: Table (default, fast iteration) vs SparseSet (fast add/remove).

## Canonical pattern

```rust
use bevy::prelude::*;

// 1. Plain components.
#[derive(Component, Default)]
struct Health(f32);

#[derive(Component)]
struct Velocity(Vec3);

// 2. Required components — spawning `Player` auto-spawns the rest.
//    `#[require]` accepts `Type` (Default), `Type(args)` (tuple constructor),
//    or `Type = expression`.
#[derive(Component)]
#[require(Health = Health(100.0), Velocity = Velocity(Vec3::ZERO), Transform)]
struct Player;

// 3. Sparse storage for components added/removed every frame (e.g. tags
//    flipped by gameplay). Default Table storage is faster to iterate.
#[derive(Component)]
#[component(storage = "SparseSet")]
struct Stunned;

// 4. An entity-targeted event reacted to by observers.
#[derive(EntityEvent)]
struct Damage {
    entity: Entity, // EntityEvent requires an `entity` field.
    amount: f32,
}

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, spawn_player)
        .add_systems(Update, deal_damage)
        .add_observer(on_damage)
        .run();
}

fn spawn_player(mut commands: Commands) {
    commands.spawn(Player);
}

fn deal_damage(mut commands: Commands, query: Query<Entity, With<Player>>) {
    for entity in &query {
        commands.trigger(Damage { entity, amount: 10.0 });
    }
}

// Observer parameter is `On<E>`, not `Trigger<E>` (renamed in 0.17, PR #19596).
fn on_damage(damage: On<Damage>, mut query: Query<&mut Health>) {
    let event = damage.event();
    if let Ok(mut hp) = query.get_mut(event.entity) {
        hp.0 -= event.amount;
    }
}
```

## Bevy 0.19 gotchas

- **`Trigger<E>` is gone.** Observer params are `On<E>` in 0.17+. Methods: `event()`, `event_mut()`, `observer()`, `original_event_target()`, `propagate(bool)`.
- **`EntityEvent::set_target`** requires `use bevy::ecs::entity::SetEntityEventTarget;` — not in the prelude.
- **Storage choice is irrevocable**: it is compiled into the component. SparseSet is designed for frequent insertion/removal; Table is the default and usually iterates faster. Benchmark the real workload before changing storage.
- **`#[require(T)]` runs `T::default()`**. If `T: !Default`, use `#[require(T = expression)]` or `#[require(T = T::new(...))]`.
- **Required components are recursive.** If `A` requires `B` and `B` requires `C`, inserting `A` also inserts `C`. A constructor specified directly by `A` wins over an inherited constructor; requirement cycles are invalid.
- **`Replace` became `Discard` in 0.19.** Use hooks `on_add`, `on_insert`, `on_discard`, and `on_remove`; the derive attribute is `#[component(on_discard = path)]`.
- **Hooks** run inside `World` mutations, cannot take arbitrary `SystemParam`s, and cannot despawn the entity they fire on. Use observers when you need flexibility.
- **`Resource` is now a `Component` subtrait.** Do not derive both. Each resource value lives as a component on a resource entity, and inserting another value of the same resource type can move which entity owns the singleton; keep ordinary entity components and global resources as distinct types unless that behavior is intentional.
- **`Bundle` derive still exists** but most use-cases are better served by `#[require(...)]` on a "marker" component, which keeps the spawn surface ergonomic.

## See also

- `bevy-ecs-queries` — reading components back out.
- `bevy-ecs-systems` — observers are themselves systems.
- `bevy-migration-0-17-to-0-18` — full `Trigger`→`On` and event→message rename map.
- `bevy-migration-0-18-to-0-19` — `Discard` lifecycle events and resources-as-components.
