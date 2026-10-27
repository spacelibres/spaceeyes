// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Run the same locked, vendored protoc used by Rust generation for the TS generator.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let status = std::process::Command::new(protoc_bin_vendored::protoc_bin_path()?)
        .args(std::env::args_os().skip(1))
        .status()?;
    std::process::exit(status.code().unwrap_or(1));
}
