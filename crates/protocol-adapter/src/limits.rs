// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Public capability limits are the same constants used by wire validation.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
pub const MAX_IDENTIFIER_BYTES: usize = 256;
pub const MAX_SCENE_COMMANDS: usize = 1024;
pub const MAX_OBJECT_RESOURCES: usize = 256;
pub const MAX_OBJECT_PAGE_SIZE: u32 = 256;
pub const MAX_EVENT_PAGE: u32 = 128;
pub const PROTOCOL_MAJOR: u32 = 1;
pub const PROTOCOL_MINOR: u32 = 0;
pub const SCHEMA_ID: &str = "spaceeyes.core.v1";
pub const OPERATIONS: &[&str] = &[
    "lifecycle.start",
    "lifecycle.stop",
    "spatial.register_root",
    "spatial.register_child_sample",
    "spatial.register_provider_frame",
    "spatial.update_provider_frame_sample",
    "scene.create",
    "scene.remove",
    "scene.set_parent",
    "scene.set_visibility",
    "scene.set_frame",
    "scene.set_resources",
    "scene.set_camera",
    "scene.set_sphere",
    "scene.set_mesh",
    "scene.set_line",
    "scene.transaction",
    "resources.register_mesh",
    "resources.register_texture",
    "time.play",
    "time.pause",
    "time.seek",
    "time.step",
    "time.set_rate",
    "query.session_status",
    "query.resolve_frame",
    "query.capabilities",
    "query.pick_presented",
    "camera.focus",
    "query.camera_state",
    "query.project_export",
    "query.list_objects",
    "query.events",
    "query.frame_coverage",
    "query.resource_stats",
    "resources.begin_upload",
    "resources.append_upload",
    "resources.finish_upload",
    "resources.cancel_upload",
    "query.upload",
    "query.time_convert",
    "query.evaluate_dynamo",
    "query.dynamo_orbit",
];
