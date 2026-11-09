# bevy-animation — Curves, Tweening, and AnimatableKeyframeCurve

> Referenced from `bevy-animation/SKILL.md § Topics`.

## Imports

These types are **not** in `bevy::prelude`. Explicit imports are required:

```rust
use bevy::{
    animation::{
        animated_field,
        animation_curves::{AnimatableCurve, AnimatableKeyframeCurve},
    },
    math::curve::{EasingCurve, EaseFunction},
    math::cubic_splines::CubicSegment,
    prelude::*,
};
```

## AnimatableKeyframeCurve — building a clip curve from keyframes

```rust
use bevy::{
    animation::{
        animated_field, AnimationTargetId,
        animation_curves::{AnimatableCurve, AnimatableKeyframeCurve},
    },
    prelude::*,
};

fn build_procedural_clip() -> AnimationClip {
    // Keyframe curve: time/value pairs, times must be strictly increasing
    let tween = AnimatableKeyframeCurve::new([
        (0.0_f32, Vec3::ZERO),
        (0.5,     Vec3::new(0.0, 1.0, 0.0)),
        (1.0,     Vec3::ZERO),
    ])
    .expect("keyframe times must be strictly increasing with >= 2 samples");

    // animated_field!(Component::field) returns an AnimatedField implementing AnimatableProperty.
    // Wrap with AnimatableCurve to produce an AnimationCurve attachable to a clip.
    let anim_curve = AnimatableCurve::new(animated_field!(Transform::translation), tween);

    let bone_id = AnimationTargetId::from_name(&Name::new("Hips"));
    let mut clip = AnimationClip::default();
    clip.add_curve_to_target(bone_id, anim_curve);
    clip
}
```

`AnimatableKeyframeCurve::new` returns `Result` — the error fires if sample times are not strictly increasing or fewer than 2 samples are provided.

## EasingCurve — simple two-value lerp with easing

```rust
use bevy::math::curve::{EasingCurve, EaseFunction};

// Interpolates Vec3 from start to end over t ∈ [0, 1]
let rise = EasingCurve::new(
    Vec3::ZERO,
    Vec3::new(0.0, 5.0, 0.0),
    EaseFunction::CubicInOut,
);

// Sample at any t:
let pos = rise.sample_clamped(0.75); // Vec3 at 75% of the ease
```

Common `EaseFunction` variants: `Linear`, `SineIn`, `SineOut`, `SineInOut`, `CubicIn`, `CubicOut`, `CubicInOut`, `QuarticInOut`, `ExponentialOut`, and others.

## CubicSegment::new_bezier_easing — CSS cubic-bezier

```rust
use bevy::math::cubic_splines::CubicSegment;

// CSS cubic-bezier(0.25, 0.1, 0.25, 1.0) — equivalent to "ease"
let bezier = CubicSegment::new_bezier_easing([0.25_f32, 0.1], [0.25, 1.0]);
// Returns a CubicSegment<Vec2>; evaluate via .position(t)
let value = bezier.position(0.5_f32);
```

Arguments are `p1` and `p2` control points in the CSS convention (p0 = [0,0], p3 = [1,1]). `x` is time, `y` is output value.

## UnevenSampleAutoCurve — auto-smooth between sparse keyframes

`UnevenSampleAutoCurve` lives in `bevy::math::curve::sample_curves`. It fits a smooth curve through unevenly-spaced samples, avoiding the linear-interpolation staircase of `AnimatableKeyframeCurve` without requiring manual spline handle placement.

```rust
use bevy::{
    math::curve::{sample_curves::UnevenSampleAutoCurve, Curve},
    prelude::Vec3,
};

let path = UnevenSampleAutoCurve::new([
    (0.0_f32, Vec3::ZERO),
    (0.4, Vec3::new(1.0, 2.0, 0.0)),
    (1.0, Vec3::new(3.0, 1.0, 0.0)),
])
.expect("the hard-coded path must contain at least two finite-time samples");

let position = path.sample_clamped(0.65);
```

The constructor filters non-finite sample times, sorts the remainder, and returns an
error if fewer than two valid timed samples remain. Sampling requires the value type
to implement `StableInterpolate`; Bevy vectors and quaternions do. Prefer
`AnimatableKeyframeCurve` when you want linear keyframe control; prefer
`UnevenSampleAutoCurve` for stable smooth interpolation between sparse samples.

## Non-clip tweening: a UI panel scale-up system

When you don't need the full `AnimationClip` pipeline, sample a curve directly in `Update`:

```rust
use bevy::math::curve::{EasingCurve, EaseFunction};

#[derive(Component)]
struct ScaleTween {
    curve: EasingCurve<Vec3>,
    elapsed: f32,
    duration: f32,
}

fn scale_tween_system(
    time: Res<Time>,
    mut query: Query<(&mut Transform, &mut ScaleTween)>,
) {
    for (mut tf, mut tween) in &mut query {
        tween.elapsed = (tween.elapsed + time.delta_secs()).min(tween.duration);
        let t = tween.elapsed / tween.duration;
        tf.scale = tween.curve.sample_clamped(t);
    }
}

// Spawn a panel with this component:
// commands.spawn((
//     Node::default(),
//     ScaleTween {
//         curve: EasingCurve::new(Vec3::ZERO, Vec3::ONE, EaseFunction::CubicOut),
//         elapsed: 0.0,
//         duration: 0.4,
//     },
// ));
```

This approach runs in `Update`, avoids `AnimationPlayer`, and has no scheduling conflicts with `PostUpdate` animation systems.

## Gotchas

- `animated_field!` is NOT re-exported from `bevy::prelude`. Always import from `bevy::animation::animated_field`.
- `AnimatableCurve` and `AnimatableKeyframeCurve` are in `bevy::animation::animation_curves`, not `bevy::animation` directly.
- `EaseFunction` is in `bevy::math::curve`, not `bevy::animation`.
- `AnimatableKeyframeCurve::new` returns `Result`. Propagate or report invalid runtime
  data; use `.expect(...)` only for hard-coded startup data whose validity is an
  invariant.

## See also

- [`../SKILL.md`](../SKILL.md) — top-level bevy-animation skill
- [`procedural-animation.md`](procedural-animation.md) — scheduling procedural writes relative to animation systems
- [`animation-graph.md`](animation-graph.md) — attaching `AnimatableCurve` via `clip.add_curve_to_target`
