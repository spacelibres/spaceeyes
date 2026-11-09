# bevy-fluent — components and derives

## Three distinct roles

`#[derive(EsFluent)]` implements the typed `FluentMessage` lookup contract.
`#[derive(BevyFluentText)]` submits registration metadata so `I18nPlugin` adds
the appropriate refresh systems. `FluentText<T>` is the ECS component placed
next to Bevy's `Text` component.

```rust
use es_fluent::EsFluent;
use es_fluent_manager_bevy::{BevyFluentText, FluentText};

#[derive(BevyFluentText, Clone, EsFluent)]
#[fluent(namespace = "ui")]
pub enum UiMessage {
    StartGame,
    Settings,
}

fn spawn_label(mut commands: Commands) {
    commands.spawn((
        FluentText::new(UiMessage::StartGame),
        Text::new(""),
    ));
}
```

In `es-fluent-manager-bevy 0.19.2`, registration requires:

```rust
T: es_fluent::FluentMessage + Clone + Send + Sync + 'static
```

The message type does not need to derive Bevy `Component`; the wrapper already
does. Advice based on `0.18.12` that adds `Component` to every message key is
stale.

## Text sibling

The refresh system writes into a sibling `Text`. Without that component, there
is nowhere to display the translation. Add `TextFont`, `TextColor`, and layout
components normally; only the content is managed by `FluentText<T>`.

## Manual registration

For an external type that cannot derive `BevyFluentText`:

```rust
use es_fluent_manager_bevy::FluentTextRegistration;

app.register_fluent_text::<ExternalMessage>();
```

Use `register_fluent_text_from_locale` when the value implements
`RefreshForLocale` and contains locale-derived fields.

## Startup failures

Invalid or duplicate module registrations are exposed through the
`I18nPluginStartupError` resource. Check it and provide a visible fallback
instead of silently shipping blank UI.

See also: [lib-target-layout.md](lib-target-layout.md),
[locale-events.md](locale-events.md).
