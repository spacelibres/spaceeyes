---
name: bevy-a11y
description: Use when designing or auditing high-standard video-game accessibility in Bevy 0.19, integrating screen readers and focus navigation, supporting adaptive controllers and complete remapping, implementing captions or audio description, checking contrast and motion safety, or building disabled-player test evidence.
license: MIT
compatibility: opencode,claude-code,cursor
metadata:
  tier: "2"
  area: accessibility
  bevy_version: "0.19"
---

# Bevy 0.19 — game accessibility

Accessibility is a cross-cutting product requirement. Start during input, UI, audio,
camera, narrative, multiplayer, and save-system design; retrofitting only labels and
captions will not solve inaccessible game mechanics.

## Standard of work

Use all four layers:

1. [Xbox Accessibility Guidelines](https://learn.microsoft.com/en-us/gaming/accessibility/guidelines)
   as the public game-specific engineering baseline.
2. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) criteria, aiming at AAA where they
   transfer meaningfully to game UI/content.
3. Platform-holder requirements and certification guidance for every shipping target.
4. Usability testing with disabled players using their own assistive technology.

WCAG AAA is not a universal native-game certification, and automated checks do not
establish conformance. Record scope, exceptions, devices, test builds, findings, and
remediation evidence. See [requirements](references/requirements.md).

## Ship these foundations first

- Every gameplay and UI action is device-neutral, remappable, conflict-checked,
  persistable, and available through menus without a pointer.
- Input supports hotplug, simultaneous devices, multiple controllers per player,
  unknown controls, adjustable deadzones/sensitivity, and digital analog alternatives.
- Holds, repeated presses, chords, rapid timing, and precision input have toggle,
  timing, or assist alternatives.
- UI has deterministic focus order, visible focus, semantic roles/names/states,
  scalable text/layout, adequate contrast, and no information conveyed only by colour.
- Dialogue and meaningful audio have synchronized closed captions; meaningful visual
  events have narration/audio-description or equivalent cues.
- Camera shake, motion blur, flashes, auto-motion, and other vestibular/photosensitive
  effects have safe defaults or independent controls.
- Accessibility settings are available before first gameplay and remain usable after
  rebinding, language changes, disconnects, and save migration.

## Bevy UI semantics and focus

`DefaultPlugins` includes `InputFocusPlugin`. Add navigation plugins explicitly and
put the accessible name on the same entity as the interactive control:

```rust
use bevy::{
    input_focus::{
        directional_navigation::DirectionalNavigationPlugin,
        tab_navigation::TabNavigationPlugin,
    },
    prelude::*,
    ui::auto_directional_navigation::AutoDirectionalNavigation,
};

fn main() {
    App::new()
        .add_plugins((
            DefaultPlugins,
            TabNavigationPlugin,
            DirectionalNavigationPlugin,
        ))
        .add_systems(Startup, setup)
        .run();
}

fn setup(mut commands: Commands) {
    commands.spawn(Camera2d);
    commands.spawn((
        Button,
        AccessibleLabel::new("Start game"),
        AutoDirectionalNavigation::default(),
        children![Text::new("Start game")],
    ));
}
```

Focus, hover, pointer capture, and screen-reader focus are related but not identical.
Test keyboard, D-pad/stick, switch-style scanning, touch, pointer, and a real screen
reader. Use AccessKit nodes for custom widgets and expose changing value/state—not only
a static label. See [screen readers and navigation](references/screen-readers-and-navigation.md).

## Adaptive and accessibility controllers

Adaptive controllers normally arrive through standard gamepad/HID mappings. Do not
gate features on a brand, vendor ID, or a particular device name. Treat every
`Gamepad` entity as capabilities and bindings:

```rust
use bevy::prelude::*;

fn read_gamepads(gamepads: Query<(Entity, &Gamepad)>) {
    for (entity, gamepad) in &gamepads {
        let move_axis = gamepad.left_stick();
        let activate = gamepad.just_pressed(GamepadButton::South);
        let extra = gamepad.just_pressed(GamepadButton::Other(0));
        let _sample = (entity, move_axis, activate, extra);
    }
}
```

With `default-features = false`, native discovery requires Bevy's `bevy_gilrs`
feature, not only `gamepad`. `leafwing-input-manager 0.21` is a compatible optional
action layer, but it does not create accessible settings, UI, persistence, or mechanic
alternatives for you. See [input and adaptive controllers](references/input-and-adaptive-controllers.md).

## Requirements by access need

| Area | Non-negotiable implementation |
|---|---|
| Blind/low vision | semantic UI, full non-pointer navigation, narration/audio description, text scale, strong focus/contrast, non-colour cues |
| Deaf/hard of hearing | closed captions with speaker and meaningful sound cues, visual/haptic equivalents, independent mix controls |
| Motor | full remapping, simultaneous devices, no mandatory holds/mashing/chords, timing/aim/movement assists, pauseability where possible |
| Cognitive/learning | consistent navigation, plain language, objective history, tutorials, adjustable pacing/difficulty, low-distraction modes |
| Speech/communication | no voice-only requirement, accessible text chat, speech-to-text/text-to-speech where communication is core |
| Photosensitive/vestibular | flash safety, reduced motion, shake/FOV/blur controls, no essential parallax/auto-motion |

Read [visual, cognitive, and motion](references/visual-cognitive-motion.md) and
[captions, audio, and communication](references/captions-audio-communication.md).

## Implementation gates

- Run `scripts/audit_input_map.py` on the action manifest before input freezes.
- Run `scripts/check_contrast.py` on every theme/state pair; sample image/video
  backgrounds separately.
- Run `scripts/validate_captions.py` on source and localized VTT/SRT files.
- Execute the manual matrix in [testing and evidence](references/testing-and-evidence.md).
- Do not advertise accessibility feature tags until the shipping build and supported
  input/platform combinations have been verified.

Script formats and CI examples are in [tooling](references/tooling.md).

## See also

- [`bevy-input-actions`](../bevy-input-actions/SKILL.md) — logical actions,
  remapping, device hot-plug, Steam Deck, and adaptive-controller integration.
- [`bevy-audio`](../bevy-audio/SKILL.md) — captions/cue boundary, category mixes,
  spatial limitations, and browser audio startup.
- [`bevy-ui`](../bevy-ui/SKILL.md) — layout, text, interaction, and focus APIs.
- [`bevy-cargo-features`](../bevy-cargo-features/SKILL.md) — controller and UI backends.
- [`bevy-fluent`](../bevy-fluent/SKILL.md) — localized text and captions.
- [`bevy-cameras`](../bevy-cameras/SKILL.md) — shake, FOV, and viewport controls.
- [`bevy-physics`](../bevy-physics/SKILL.md) — accessible character movement, aim,
  and timing mechanics built over physics.
- [`bevy-testing`](../bevy-testing/SKILL.md) — deterministic checks and capture evidence.
- [`bevy-core-concepts`](../bevy-core-concepts/SKILL.md) — schedule architecture.
