---
name: bevy-ui
description: Use when building Bevy 0.19 UI with `Node`, `Button`, `children![]`, `TextFont`/`FontSource`/`FontSize`, `InputFocus`, `AccessibleLabel`, `BackgroundColor`, `BorderColor`, or `BorderRadius`, or when `Changed<Interaction>` behaves unexpectedly.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: ui
  bevy_version: "0.19"
---

# Bevy 0.19 — UI

## When to use this skill

- Spawn `Node`-based panels, buttons, labels, overlays, or menus.
- Handle `Interaction::{None, Hovered, Pressed}` and visual states.
- Style text after the 0.19 Parley migration.
- Manage pointer-acquired `InputFocus` or accessible names.
- Build static trees with `children![]` or dynamic trees with `with_children`.

## Canonical pattern

```rust
use bevy::{
    input_focus::{FocusCause, InputFocus},
    prelude::*,
};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins) // includes InputFocusPlugin in 0.19
        .add_systems(Startup, setup)
        .add_systems(Update, style_button)
        .run();
}

fn setup(mut commands: Commands, assets: Res<AssetServer>) {
    commands.spawn(Camera2d);
    commands.spawn((
        Node {
            width: percent(100),
            height: percent(100),
            align_items: AlignItems::Center,
            justify_content: JustifyContent::Center,
            ..default()
        },
        children![(
            Button,
            AccessibleLabel::new("Start game"),
            Node {
                width: px(180),
                height: px(64),
                border: UiRect::all(px(3)),
                border_radius: BorderRadius::MAX,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            BackgroundColor(Color::srgb(0.12, 0.12, 0.15)),
            BorderColor::all(Color::WHITE),
            children![(
                Text::new("Start game"),
                TextFont {
                    font: assets.load("fonts/FiraSans-Bold.ttf").into(),
                    font_size: FontSize::Px(32.0),
                    ..default()
                },
                TextColor(Color::WHITE),
            )],
        )],
    ));
}

fn style_button(
    mut focus: ResMut<InputFocus>,
    mut buttons: Query<
        (Entity, &Interaction, &mut BackgroundColor),
        (Changed<Interaction>, With<Button>),
    >,
) {
    for (entity, interaction, mut background) in &mut buttons {
        *background = match interaction {
            Interaction::Pressed => {
                focus.set(entity, FocusCause::Pressed);
                BackgroundColor(Color::srgb(0.15, 0.55, 0.25))
            }
            Interaction::Hovered => BackgroundColor(Color::srgb(0.22, 0.22, 0.28)),
            Interaction::None => BackgroundColor(Color::srgb(0.12, 0.12, 0.15)),
        };
    }
}
```

## Topics

| Topic | Reference |
|---|---|
| `Node`, `Val`, flex/grid layout | [Layout](references/layout.md) |
| `FontSource`, `FontSize`, `TextLayout` | [Text](references/text.md) |
| `Button`, `Interaction`, `Changed` | [Interaction](references/interaction.md) |
| Colors, borders, and radii | [Colors and borders](references/colors-and-borders.md) |
| Palette constants | [Palettes](references/palettes.md) |
| `InputFocus`, semantics, accessible labels | [Accessibility](references/accessibility.md) |
| Static and dynamic children | [Children](references/children-macro.md) |
| Cross-cutting traps | [Gotchas](references/gotchas.md) |

## Gotchas

- A newly inserted component satisfies `Changed<T>`. The interaction system
  normally visits a new button on its first `Update`; use `Ref<T>::is_added()`
  when insertion and later mutation must be distinguished.
- Pointer hover and input focus are different. Do not move or clear keyboard /
  assistive-technology focus merely because the cursor entered or left.
- `TextFont.font` is `FontSource`; convert a `Handle<Font>` with `.into()`.
  `font_size` is `FontSize`, such as `FontSize::Px(32.0)`.
- `InputFocus` fields are private. Use `get`, `set(entity, FocusCause)`, and
  `clear`. `DefaultPlugins` initializes it.
- A visible text child gives a `Button` an inferred name, but use
  `AccessibleLabel` when the visual text is absent, decorative, or ambiguous.

## See also

- [`bevy-a11y`](../bevy-a11y/SKILL.md) — full game accessibility implementation.
- [`bevy-fluent`](../bevy-fluent/SKILL.md) — localized UI text.
- [`bevy-cameras`](../bevy-cameras/SKILL.md) — UI cameras and render targets.
- [`bevy-ecs-queries`](../bevy-ecs-queries/SKILL.md) — change detection.
