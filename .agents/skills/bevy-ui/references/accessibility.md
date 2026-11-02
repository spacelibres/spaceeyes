# Bevy 0.19 UI accessibility

## Focus setup

`DefaultPlugins` includes `InputFocusPlugin` in Bevy 0.19, so do not initialize
`InputFocus` a second time. Minimal/headless plugin sets must add the plugin
explicitly if they use focus dispatch.

```rust
use bevy::{
    input_focus::{FocusCause, InputFocus},
    prelude::*,
};

fn focus_pressed_button(
    mut focus: ResMut<InputFocus>,
    buttons: Query<(Entity, &Interaction), (Changed<Interaction>, With<Button>)>,
) {
    for (entity, interaction) in &buttons {
        if *interaction == Interaction::Pressed {
            focus.set(entity, FocusCause::Pressed);
        }
    }
}
```

Use `FocusCause::Navigated` for keyboard/gamepad navigation and
`FocusCause::Pressed` for a primary pointer press. Read with `focus.get()` and
clear only when the UI flow intentionally has no focused control. Hover is not
focus.

## Semantics and names

Bevy creates accessibility nodes for standard UI `Button`, `Label`, and image
components. Text children are used to infer names. Add an explicit
`AccessibleLabel::new("...")` to icon-only or ambiguous controls; update that
component when the name changes.

For nonstandard widgets, add `bevy_a11y::AccessibilityNode` with an AccessKit
role, state, value, actions, and relationships. Depend directly on the same
AccessKit line Bevy uses (`accesskit = "0.24"`) only when the convenience
components cannot express the widget.

Keyboard tab order and spatial gamepad navigation are separate concerns. Add
`TabNavigationPlugin` with `TabGroup`/`TabIndex`, or directional navigation with
`AutoDirectionalNavigation`; neither should be inferred from pointer hover.

## Boundary

This reference covers Bevy UI primitives. Use [`bevy-a11y`](../../bevy-a11y/SKILL.md)
for captions, contrast, remapping, adaptive controllers, non-visual gameplay,
testing with disabled players, and release gates.
