---
name: bevy-ecs-systems
description: Use when deriving `SystemParam`, grouping with `SystemSet`, gating execution with `.run_if(on_message::<M>())`/`in_state(...)`/`resource_exists::<R>`, ordering with `.before`/`.after`/`.chain()`, removing systems with `remove_systems_in_set`, or adapting resource bounds in Bevy 0.19.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "1"
  area: ecs
  bevy_version: "0.19"
---

# Bevy 0.19 — ECS Systems (params, sets, run conditions)

## When to use this skill

- Bundling related state into a single system parameter via `#[derive(SystemParam)]`.
- Grouping systems into a `SystemSet` so callers can order against the whole group.
- Gating systems with run conditions (`run_if`, `on_message`, `in_state`, `resource_exists`, `any_with_component`).
- Hooking into state transitions with `OnEnter(S)` / `OnExit(S)` / `OnTransition { from, to }`.
- Hot-removing systems at runtime (e.g. tearing down a debug overlay) with `remove_systems_in_set`.
- Hitting `ScheduleBuildError` ambiguity panics — the executor no longer guesses.

## Canonical pattern

```rust
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;

#[derive(SystemSet, Hash, PartialEq, Eq, Clone, Debug)]
enum GameLoop { Input, Simulate, Render }

#[derive(States, Default, Hash, PartialEq, Eq, Clone, Debug)]
enum AppState { #[default] Loading, Playing }

#[derive(Resource, Default)]
struct Score(u32);

#[derive(Message)]
struct GoalScored { team: u8 }

// Composite param: pass one argument, get four.
// 'w = world borrow; 's = system-local state borrow.
#[derive(SystemParam)]
struct GameCtx<'w, 's> {
    time:  Res<'w, Time>,
    score: ResMut<'w, Score>,
    goals: MessageReader<'w, 's, GoalScored>,
}

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .init_resource::<Score>()
        .add_message::<GoalScored>()
        .init_state::<AppState>()
        .configure_sets(Update, (GameLoop::Input, GameLoop::Simulate, GameLoop::Render).chain())
        // State schedule: fires once when entering Playing.
        .add_systems(OnEnter(AppState::Playing), spawn_level)
        // State schedule: fires once when leaving Playing.
        .add_systems(OnExit(AppState::Playing), despawn_level)
        .add_systems(Update, read_input.in_set(GameLoop::Input))
        .add_systems(
            Update,
            tally_goals
                .in_set(GameLoop::Simulate)
                .run_if(on_message::<GoalScored>),
        )
        .add_systems(Update, draw_hud.in_set(GameLoop::Render))
        .run();
}

#[derive(Component)]
struct LevelEntity;

fn spawn_level(mut commands: Commands) {
    commands.spawn((LevelEntity, Name::new("level")));
}

fn despawn_level(mut commands: Commands, query: Query<Entity, With<LevelEntity>>) {
    for e in &query { commands.entity(e).despawn(); }
}

fn read_input(mut writer: MessageWriter<GoalScored>) {
    writer.write(GoalScored { team: 0 });
}

fn tally_goals(mut ctx: GameCtx) {
    let _ = ctx.time.delta_secs();
    for goal in ctx.goals.read() {
        ctx.score.0 += 1;
        info!("team {} scored, total {}", goal.team, ctx.score.0);
    }
}

fn draw_hud(score: Res<Score>) { let _ = score.0; }
```

## Run condition cheat sheet

| Built-in | Triggers when |
|---|---|
| `on_message::<M>` | The `Messages<M>` buffer has unread items. |
| `resource_exists::<R>` | Resource `R` is in the `World`. |
| `resource_changed::<R>` | `R` was mutated this tick. |
| `in_state(MyState::X)` | Current `State<MyState>` equals `X`. |
| `state_changed::<MyState>` | The state changed this tick. |
| `any_with_component::<C>` | At least one entity has `C`. |

Combine with `.and()` / `.or()`: `run_if(in_state(GameState::Playing).and(resource_exists::<NetSession>()))`.

## Topics

| Topic | Reference |
|---|---|
| `#[derive(SystemParam)]`, `'w`/`'s` lifetimes, `Local<T>`, `Commands` deferred apply | [references/system-params.md](references/system-params.md) |
| `#[derive(SystemSet)]` requirements, `.in_set`, `.configure_sets`, `.chain()` | [references/system-sets.md](references/system-sets.md) |
| Every built-in condition, `.and()`/`.or()`/`not()`, custom conditions, cost rule | [references/run-conditions.md](references/run-conditions.md) |
| `OnEnter(S)` / `OnExit(S)` / `OnTransition`, `NextState<S>`, `set_if_neq` | [references/state-schedules.md](references/state-schedules.md) |
| `.before`, `.after`, `.chain()`, `.ambiguous_with`, debugging ambiguity errors | [references/ordering.md](references/ordering.md) |
| `remove_systems_in_set`, cleanup policies, cross-schedule runtime removal, side-effect limits | [references/runtime-removal.md](references/runtime-removal.md) |

## Bevy 0.19 gotchas

- **Shared access does not define order.** Conflicting mutable systems are serialized,
  but their relative order is unspecified. Enable ambiguity diagnostics and add
  `.before`, `.after`, or `.chain()` when behavior depends on order. See
  [references/ordering.md](references/ordering.md).
- **`MessageReader` / `MessageWriter`, not `EventReader` / `EventWriter`.** Renamed in 0.17. Trait derive is `#[derive(Message)]`; registrar is `app.add_message::<M>()`.
- **`next_state.set(S)` always fires `OnExit`/`OnEnter` in 0.18.** Use `set_if_neq` for the old behaviour. See [references/state-schedules.md](references/state-schedules.md).
- **Do not remove the currently running schedule through `Schedules`.** It is
  temporarily absent from that resource. Remove `Update` systems from a later/different
  schedule such as `Last`. See [references/runtime-removal.md](references/runtime-removal.md).
- **`Resource: Component` in 0.19.** Generic system parameters still use `Res<T>`/`ResMut<T>`, but a `T: Resource` bound no longer proves that `T` cannot appear in a component query.

## See also

- `bevy-core-concepts` — which schedule (`Startup`, `Update`, `FixedUpdate`) to add a system to.
- `bevy-ecs-queries` — query is one of many `SystemParam`s; `Changed<T>` / `Added<T>` filters.
- `bevy-ecs-components` — defining the `Component` types your systems act on.
- `bevy-migration-0-17-to-0-18` — full Message/Event rename, `MaterialPlugin` changes.
- `bevy-migration-0-18-to-0-19` — resource bounds and executor configuration.
