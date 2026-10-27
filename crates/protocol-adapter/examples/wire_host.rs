// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Test host for TS interop: one routing byte, u32-LE byte length, then unchanged Proto.
use spaceeyes_engine::{CommandDispatcher, Engine};
use spaceeyes_protocol_adapter::{limits::MAX_MESSAGE_BYTES, ProtocolAdapter};
use spaceeyes_time::TimeInstant;
use std::io::{Read, Write};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut adapter = ProtocolAdapter::new(
        CommandDispatcher::new(
            Engine::new(TimeInstant::new("TT", "prototype", -9_007_199_254_740_993, 0).unwrap()),
            "interop-session".into(),
            4096,
        )
        .map_err(|e| std::io::Error::other(format!("{e:?}")))?,
    )
    .map_err(|e| std::io::Error::other(format!("{e:?}")))?;
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut route = [0];
        if input.read(&mut route)? == 0 {
            break;
        }
        let mut length = [0; 4];
        input.read_exact(&mut length)?;
        let size = u32::from_le_bytes(length) as usize;
        if size > MAX_MESSAGE_BYTES {
            return Err(std::io::Error::other("oversized Proto frame").into());
        }
        let mut bytes = vec![0; size];
        input.read_exact(&mut bytes)?;
        let response = match route[0] {
            0 => adapter.submit_bytes("authenticated-host", &bytes),
            1 => adapter.query_bytes("authenticated-host", &bytes),
            _ => return Err(std::io::Error::other("invalid transport route").into()),
        }
        .map_err(|e| std::io::Error::other(format!("{e:?}")))?;
        output.write_all(&(response.len() as u32).to_le_bytes())?;
        output.write_all(&response)?;
        output.flush()?;
    }
    Ok(())
}
