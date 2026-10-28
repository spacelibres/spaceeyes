# Bevy 0.19 UI gotchas

## `Changed<T>` includes insertion

`Changed<Interaction>` is true when the component was added and when it was
mutated since the system last ran. A new button therefore reaches its
`Interaction::None` styling arm on the first `Update`.

To distinguish the cases, query `Ref<Interaction>` and inspect `is_added()` /
`is_changed()`, or use separate `Added<Interaction>` and `Changed<Interaction>`
systems with explicit ordering.

## Focus is not hover

Moving focus on `Hovered` makes keyboard, switch, and screen-reader context jump
when a mouse happens to move. Set `InputFocus` for explicit navigation or a
press, and do not clear it merely on `Interaction::None`.

## `InputFocus` setup changed

`DefaultPlugins` installs `InputFocusPlugin`. The resource fields are private;
use `get()`, `set(entity, FocusCause)`, and `clear()`. Minimal plugin sets must
add `InputFocusPlugin` themselves.

## Text types changed

`TextFont.font` is a `FontSource`, and `font_size` is a `FontSize` (`Px`, `Vh`,
or `Rem`). The old `Handle<Font>` and bare `f32` field values do not compile.
`TextLayout::new_with_justify` became `TextLayout::justify`.

## Button requirements

In 0.19 `Button` requires `Node`, `Interaction`, and blocking focus policy, so
those components are inserted automatically. It still needs a nonzero computed
layout area and a UI camera to receive pointer interaction.

## `children![]` grouping

Each macro item is one child bundle. Wrap multiple components for one entity:

```rust
children![(Button, Node { width: px(100), ..default() }, BackgroundColor::default())]
```

Without the tuple, the items become separate child entities.

## Accessible names

Do not mutate `Button` merely to force an accessibility refresh. Bevy updates a
button's generated node when the button changes, but dynamic names should be
represented directly with `AccessibleLabel`, and custom state with
`AccessibilityNode`.
