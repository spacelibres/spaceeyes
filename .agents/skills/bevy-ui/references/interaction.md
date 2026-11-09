# Bevy 0.19 UI interaction

`Button` requires `Node`, `FocusPolicy::Block`, and `Interaction`; Bevy inserts
those required components. A UI camera and nonzero computed bounds are still
necessary for hit testing.

```rust
use bevy::{
    input_focus::{FocusCause, InputFocus},
    prelude::*,
};

fn button_system(
    mut focus: ResMut<InputFocus>,
    mut buttons: Query<
        (Entity, &Interaction, &mut BackgroundColor, &mut BorderColor),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (entity, interaction, mut bg, mut border) in &mut buttons {
        match interaction {
            Interaction::Pressed => {
                focus.set(entity, FocusCause::Pressed);
                *bg = BackgroundColor(Color::srgb(0.15, 0.55, 0.25));
                *border = BorderColor::all(Color::WHITE);
            }
            Interaction::Hovered => {
                *bg = BackgroundColor(Color::srgb(0.25, 0.25, 0.3));
                *border = BorderColor::all(Color::WHITE);
            }
            Interaction::None => {
                *bg = BackgroundColor(Color::srgb(0.12, 0.12, 0.15));
                *border = BorderColor::all(Color::srgb(0.4, 0.4, 0.45));
            }
        }
    }
}
```

## Pitfalls

- `Changed<Interaction>` includes initial insertion. Use `Ref<Interaction>` and
  `is_added()` when the initial `None` state needs different handling.
- Pointer hover is not input focus. Set focus on an explicit press or navigation
  event; do not clear it on cursor exit.
- You do not need `button.set_changed()` to announce a focus change. Mutating
  `Button` causes Bevy to rebuild its generated role/name; represent a changing
  name with `AccessibleLabel` instead.
- Interaction belongs to the button entity, not its text/icon children.
- Keyboard/gamepad activation is not implied by pointer `Interaction`; wire an
  action system and navigation policy explicitly. See `bevy-a11y`.
