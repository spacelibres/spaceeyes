# Bevy 0.19 — runtime system removal

`remove_systems_in_set` removes every system in a named `SystemSet` and rebuilds the
schedule. Use it for genuinely unloadable modules; a run condition is cheaper and
simpler for ordinary enable/disable behavior.

## Receivers

| Receiver | Arguments after `self` | Typical use |
|---|---|---|
| `App` / `SubApp` | schedule, set, policy | app construction or controlled reconfiguration |
| `Schedules` resource | schedule, set, world, policy | runtime exclusive system targeting another stored schedule |
| `Schedule` | set, world, policy | direct ownership of one schedule |

At app construction:

```rust
use bevy::ecs::schedule::ScheduleCleanupPolicy;

app.remove_systems_in_set(
    Update,
    DebugOverlaySet::All,
    ScheduleCleanupPolicy::RemoveSystemsOnly,
);
```

## Cleanup policies

| Variant | Set removed | Adds replacement dependency edges |
|---|---:|---:|
| `RemoveSetAndSystems` (default) | yes | yes |
| `RemoveSystemsOnly` | no | yes |
| `RemoveSetAndSystemsAllowBreakages` | yes | no |
| `RemoveSystemsOnlyAllowBreakages` | no | no |

The “allow breakages” variants can destroy transitive ordering guarantees. Use them
only after inspecting all before/after relationships around the removed set.

## Runtime pattern

A schedule is temporarily removed from the `Schedules` resource while it runs. An
exclusive system in `Update` therefore cannot retrieve and mutate that same `Update`
schedule. Perform the removal from a different schedule after the target has been put
back—for example, remove `Update` systems from `Last`:

```rust
use bevy::ecs::schedule::ScheduleCleanupPolicy;
use bevy::prelude::*;

#[derive(Resource, Default)]
struct UnloadOverlay(bool);

fn unload_overlay_systems(world: &mut World) {
    if !world.resource::<UnloadOverlay>().0 {
        return;
    }

    world.resource_scope(|world, mut schedules: Mut<Schedules>| {
        let result = schedules.remove_systems_in_set(
            Update,
            DebugOverlaySet::All,
            world,
            ScheduleCleanupPolicy::RemoveSetAndSystems,
        );
        if let Err(error) = result {
            warn!("could not unload overlay systems: {error}");
        }
    });
    world.resource_mut::<UnloadOverlay>().0 = false;
}

app.init_resource::<UnloadOverlay>()
    .add_systems(Last, unload_overlay_systems);
```

If the set exists in both `Update` and `FixedUpdate`, remove it from both explicitly.
Removing one schedule never propagates to another.

## What is not cleaned up

System removal does not automatically:

- despawn owned entities;
- remove resources or components;
- remove independently registered observer entities;
- undo asset registrations or external subscriptions;
- reverse side effects already performed.

Run a teardown system first, model ownership explicitly, and test unload/reload cycles.
Do not let the removal system remove itself before all cleanup is complete.

## See also

- [System sets](system-sets.md)
- [State schedules](state-schedules.md) — often a better lifecycle boundary.
- [Ordering](ordering.md)
