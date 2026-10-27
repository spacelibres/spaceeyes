// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Synthetic wire boundaries, not a claim about real scene counts or scientific epochs.
use prost::Message;
use spaceeyes_protocol_adapter::generated as p;
use std::io::{Read, Write};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let expected = p::ResponseEnvelope {
        request_id: "wire-boundaries".into(),
        status: p::ResponseStatus::Completed as i32,
        command_sequence: u64::MAX,
        committed_scene_revision: 9_007_199_254_740_993,
        frame_sequence: u64::MAX,
        payload: Some(p::response_envelope::Payload::Session(p::SessionStatus {
            lifecycle: p::EngineLifecycle::Ready as i32,
            clock: Some(p::ClockState {
                instant: Some(p::TimeInstant {
                    time_scale: p::TimeScale::Tt as i32,
                    epoch_id: "synthetic-wire-vector".into(),
                    seconds: i64::MIN,
                    nanos: 999_999_999,
                }),
                mode: p::PlaybackMode::Paused as i32,
                rate: -0.25,
                generation: u64::MAX,
                revision: u64::MAX,
                rate_numerator: -1,
                rate_denominator: 4,
            }),
            scene_revision: 9_007_199_254_740_993,
            frame_graph_revision: u64::MAX,
            resource_revision: u64::MAX,
            frame_sequence: u64::MAX,
            object_count: 0,
            resource_used_bytes: 0,
        })),
    };
    let mut received = Vec::new();
    std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut received)?;
    if received.len() > 1024 * 1024 || p::ResponseEnvelope::decode(received.as_slice())? != expected
    {
        return Err(std::io::Error::other("TS boundary vector differs from Rust").into());
    }
    std::io::stdout().write_all(&expected.encode_to_vec())?;
    Ok(())
}
