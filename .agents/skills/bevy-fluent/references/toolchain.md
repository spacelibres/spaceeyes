# bevy-fluent — toolchain requirements

## Supported versions

The Bevy 0.19-compatible set is:

```toml
bevy = "0.19"
es-fluent = { version = "0.18.1", features = ["derive"] }
es-fluent-manager-bevy = { version = "0.19.2", features = ["macros"] }
```

Both es-fluent crates declare Rust 1.96 as their minimum supported Rust version.
Pin at least that version when the workspace does not already use a newer
stable toolchain:

```toml
# rust-toolchain.toml
[toolchain]
channel = "1.96"
```

Verify the active compiler with `rustc --version`; a dependency MSRV failure can
otherwise look like a derive or trait-resolution problem.

## Feature selection

`es-fluent-manager-bevy` defaults to `macros + file_watcher`. For release builds
that do not need hot reload, make the choice explicit:

```toml
es-fluent-manager-bevy = {
  version = "0.19.2",
  default-features = false,
  features = ["macros"],
}
```

Without `macros`, `BevyFluentText` and `define_i18n_module!` are unavailable.
Without `file_watcher`, runtime localization still works; `.ftl` edits simply
do not hot-reload.

## CI

```yaml
- uses: dtolnay/rust-toolchain@1.96
- run: cargo check --all-targets
- run: cargo es-fluent check
```

Re-check the crates' `rust-version` whenever their pins change.

See also: [cli.md](cli.md), [lib-target-layout.md](lib-target-layout.md).
