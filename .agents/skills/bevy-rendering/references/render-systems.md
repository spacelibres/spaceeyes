# Bevy 0.19 render systems

## Architectural model

Bevy still has a main world and a render sub-app. World-side components are extracted,
GPU resources are prepared, visible work is queued, and render passes run in camera
schedules. What changed in 0.19 is the pass definition: camera passes are systems, not
render-graph nodes.

```rust,ignore
pub fn my_render_pass(
    world: &World,
    view: ViewQuery<(&ExtractedCamera, &ViewTarget)>,
    mut context: RenderContext,
) {
    let (camera, target) = view.into_inner();
    // Begin an appropriate tracked render pass and issue commands.
}

render_app.add_systems(
    Core3d,
    my_render_pass
        .after(main_opaque_pass_3d)
        .in_set(Core3dSystems::MainPass),
);
```

Use the exact imports and pass APIs from the Bevy 0.19 examples for the chosen phase;
these low-level types are intentionally specific to the target pass.

## Ordering

- Order against real system functions when the dependency is precise.
- Use `Core3dSystems::{Prepass, MainPass, PostProcess}` or corresponding 2D sets for
  coarse grouping.
- Create custom views in `RenderSystems::CreateViews`, prepare them in
  `PrepareViews`, and allocate attachments in `PrepareViewAttachments`.
- Do not copy a 0.18 `Node3d` edge list into 0.19 system labels.

The schedule `bevy::render::renderer::RenderGraph` still runs top-level non-camera
rendering. Its name does not mean the removed `RenderGraph` node API still exists.

## Extraction and GPU resources

Keep the stages explicit:

1. Main-world gameplay mutates source components.
2. Extraction copies only render-relevant, frame-stable data.
3. Prepare creates or updates GPU resources.
4. Queue specializes pipelines and creates phase items.
5. Render systems issue commands for a view.

Avoid reading mutable gameplay state directly during rendering. Extract a compact
render representation so main-world scheduling and render scheduling stay decoupled.

## When a custom pass is unnecessary

Do not write a render system merely to:

- change material parameters (`Material` is enough);
- render to an image (`RenderTarget` is enough);
- apply a supported post effect (camera component/plugin is enough);
- draw debug lines (gizmos are enough);
- choose forward/deferred (use `DefaultOpaqueRendererMethod`).

## Source examples

- [Specialized mesh pipeline](https://github.com/bevyengine/bevy/blob/v0.19.1/examples/shader_advanced/specialized_mesh_pipeline.rs)
- [Render depth to texture](https://github.com/bevyengine/bevy/blob/v0.19.1/examples/shader_advanced/render_depth_to_texture.rs)
- [0.18 → 0.19 render-system migration](https://bevy.org/learn/migration-guides/0-18-to-0-19/#render-graph-as-systems)
