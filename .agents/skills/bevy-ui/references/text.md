# Bevy 0.19 UI text

Bevy 0.19 uses Parley for layout. Text remains split across components, while
font selection and sizing use `FontSource` and `FontSize`.

| Component | Purpose |
|---|---|
| `Text::new("hello")` | Content |
| `TextFont` | `FontSource`, `FontSize`, smoothing, line height |
| `TextColor` | Foreground color |
| `TextShadow` | Optional shadow |
| `TextLayout` | Justification and wrapping |

## Loaded font asset

```rust
use bevy::prelude::*;

fn text_label(assets: &AssetServer) -> impl Bundle {
    (
        Text::new("Hello, Bevy!"),
        TextFont {
            font: assets.load("fonts/FiraSans-Bold.ttf").into(),
            font_size: FontSize::Px(24.0),
            ..default()
        },
        TextColor(Color::WHITE),
    )
}
```

## Layout and relative units

```rust
use bevy::{prelude::*, text::{Justify, TextLayout}};

fn paragraph() -> impl Bundle {
    (
        Text::new("A paragraph that can wrap."),
        TextFont {
            font_size: FontSize::Rem(1.0),
            ..default()
        },
        TextLayout::justify(Justify::Left),
    )
}
```

`FontSize::Px` uses logical pixels, `Vh` is viewport-height relative, and `Rem`
is root-font relative. `TextFont::from_font_size(20.0)` is a concise pixel-size
constructor.

## Font families and fallback

`FontSource` can hold a loaded asset or a family query. Installed system-font
discovery requires Bevy's `system_font_discovery` feature and platform support:

```rust
use bevy::{prelude::*, text::FontSource};

let font = TextFont {
    font: FontSource::from("Noto Sans"),
    font_size: FontSize::Px(20.0),
    ..default()
};
```

Parley/fontique performs fallback. Do not replace the asset behind
`TextFont::default().font`; that 0.18 handle hack is obsolete because the field
is no longer a `Handle<Font>`.

## Pitfalls

- `TextBundle` is obsolete; spawn the components as a tuple.
- `TextLayout::new_with_justify`/`new_with_linebreak`/`new_with_no_wrap` became
  `justify`/`linebreak`/`no_wrap`.
- Updating a `Text` still works through its `String` deref: `**text = value`.
- Prefer bundled fonts for deterministic appearance and licensing; system font
  availability differs by machine.
