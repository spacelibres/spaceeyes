// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let compiler = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", compiler);
    prost_build::Config::new()
        .boxed(".spaceeyes.core.v1.CreateObject.object")
        .compile_protos(
            &[
                "../../proto/spaceeyes/core/v1/common.proto",
                "../../proto/spaceeyes/core/v1/resources.proto",
                "../../proto/spaceeyes/core/v1/spatial.proto",
                "../../proto/spaceeyes/core/v1/rendering.proto",
                "../../proto/spaceeyes/core/v1/scene.proto",
                "../../proto/spaceeyes/core/v1/core.proto",
                "../../proto/spaceeyes/core/v1/time.proto",
            ],
            &["../../proto"],
        )?;
    Ok(())
}
