fn main() -> Result<(), Box<dyn std::error::Error>> {
    let compiler = protoc_bin_vendored::protoc_bin_path()?;
    std::env::set_var("PROTOC", compiler);
    prost_build::Config::new().compile_protos(
        &["../../proto/spaceeyes/core/v1/common.proto", "../../proto/spaceeyes/core/v1/time.proto"],
        &["../../proto"],
    )?;
    Ok(())
}
