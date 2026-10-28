// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Bounded read-only protocol; queries never enter command history or mutate Engine.
use crate::dispatch::{dispatch_error_code, validate_wire_context};
use crate::{decode_frame_id, encode_instant, generated as p, ProtocolAdapter, ProtocolError};
use prost::Message;
use spaceeyes_engine::{CoreEvent, EngineState, EventKind, EventPage, SessionStatus};
use spaceeyes_spatial::{Quatd, RigidTransform, Vec3d};

pub(crate) fn decode_transform(value: p::RigidTransform) -> Result<RigidTransform, ProtocolError> {
    let t = value.translation_m.ok_or(ProtocolError::MissingField)?;
    let q = value.rotation.ok_or(ProtocolError::MissingField)?;
    RigidTransform::new(
        Vec3d {
            x: t.x,
            y: t.y,
            z: t.z,
        },
        Quatd {
            w: q.w,
            x: q.x,
            y: q.y,
            z: q.z,
        },
    )
    .map_err(|_| ProtocolError::InvalidContext)
}
pub(crate) fn encode_transform(value: RigidTransform) -> p::RigidTransform {
    p::RigidTransform {
        translation_m: Some(p::Vector3d {
            x: value.translation_m.x,
            y: value.translation_m.y,
            z: value.translation_m.z,
        }),
        rotation: Some(p::Quaterniond {
            w: value.rotation.w,
            x: value.rotation.x,
            y: value.rotation.y,
            z: value.rotation.z,
        }),
    }
}
fn encode_event_page(page: &EventPage) -> p::EventPage {
    p::EventPage {
        events: page.events.iter().map(encode_event).collect(),
        next_sequence: page.next_sequence,
        replay_from: page.replay_from,
    }
}
fn encode_event(event: &CoreEvent) -> p::CoreEvent {
    p::CoreEvent {
        sequence: event.sequence,
        session_id: event.session.clone(),
        kind: match event.kind {
            EventKind::SceneChanged => p::CoreEventKind::SceneChanged,
            EventKind::ClockChanged => p::CoreEventKind::ClockChanged,
            EventKind::FrameInvalidated => p::CoreEventKind::FrameInvalidated,
            EventKind::TaskStatusChanged => p::CoreEventKind::TaskStatusChanged,
            EventKind::ResourceStateChanged => p::CoreEventKind::ResourceStateChanged,
            EventKind::FramePublished => p::CoreEventKind::FramePublished,
        } as i32,
        command_sequence: event.command_sequence,
        request_id: event.request_id.clone(),
        scene_revision: event.scene_revision.0,
        frame_graph_revision: event.frame_graph_revision.0,
        resource_revision: event.resource_revision,
        frame_sequence: event.frame_sequence,
        time_generation: event.time_generation.0,
    }
}
pub(crate) fn encode_status(s: &SessionStatus) -> Result<p::SessionStatus, ProtocolError> {
    let rate = s.clock.rate;
    Ok(p::SessionStatus {
        session_id: s.session.clone(),
        lifecycle: match s.lifecycle {
            EngineState::Created => p::EngineLifecycle::Created,
            EngineState::Initializing => p::EngineLifecycle::Initializing,
            EngineState::Ready => p::EngineLifecycle::Ready,
            EngineState::Running => p::EngineLifecycle::Running,
            EngineState::Stopping => p::EngineLifecycle::Stopping,
            EngineState::Stopped => p::EngineLifecycle::Stopped,
            EngineState::Failed => p::EngineLifecycle::Failed,
        } as i32,
        clock: Some(p::ClockState {
            instant: Some(encode_instant(&s.clock.instant)?),
            mode: match s.clock.mode {
                spaceeyes_time::ClockMode::Paused => p::PlaybackMode::Paused,
                spaceeyes_time::ClockMode::Playing => p::PlaybackMode::Playing,
            } as i32,
            rate: f64::from(rate.numerator()) / f64::from(rate.denominator()),
            generation: s.clock.generation.0,
            revision: s.clock.revision,
            rate_numerator: rate.numerator(),
            rate_denominator: rate.denominator(),
        }),
        scene_revision: s.scene_revision.0,
        frame_graph_revision: s.frame_graph_revision.0,
        resource_revision: s.resource_revision,
        frame_sequence: s.frame_sequence,
        object_count: s.object_count,
        resource_used_bytes: s.resource_used_bytes,
    })
}
fn rejection(id: &str, code: p::ErrorCode, message: String) -> p::ResponseEnvelope {
    p::ResponseEnvelope {
        request_id: id.to_owned(),
        status: p::ResponseStatus::Rejected as i32,
        payload: Some(p::response_envelope::Payload::Error(p::Error {
            code: code as i32,
            message,
            request_id: id.to_owned(),
            details: vec![],
        })),
        ..Default::default()
    }
}
fn encode_utc(value: spaceeyes_time::UtcDateTime) -> p::UtcDateTime {
    p::UtcDateTime {
        year: value.year(),
        month: u32::from(value.month()),
        day: u32::from(value.day()),
        hour: u32::from(value.hour()),
        minute: u32::from(value.minute()),
        second: u32::from(value.second()),
        nanos: value.nanos(),
    }
}

fn decode_utc(value: p::UtcDateTime) -> Result<spaceeyes_time::UtcDateTime, ProtocolError> {
    spaceeyes_time::UtcDateTime::new(
        value.year,
        u8::try_from(value.month).map_err(|_| ProtocolError::InvalidTime)?,
        u8::try_from(value.day).map_err(|_| ProtocolError::InvalidTime)?,
        u8::try_from(value.hour).map_err(|_| ProtocolError::InvalidTime)?,
        u8::try_from(value.minute).map_err(|_| ProtocolError::InvalidTime)?,
        u8::try_from(value.second).map_err(|_| ProtocolError::InvalidTime)?,
        value.nanos,
    )
    .map_err(|_| ProtocolError::InvalidTime)
}

fn encode_utc_regime(regime: Option<spaceeyes_time::UtcRegime>) -> p::UtcRegime {
    match regime {
        Some(spaceeyes_time::UtcRegime::Observed) => p::UtcRegime::Observed,
        Some(spaceeyes_time::UtcRegime::Predicted) => p::UtcRegime::Predicted,
        Some(spaceeyes_time::UtcRegime::Continuous) => p::UtcRegime::Continuous,
        None => p::UtcRegime::Unspecified,
    }
}

fn convert_time(query: p::TimeConversionQuery) -> Result<p::TimeConversion, ProtocolError> {
    use spaceeyes_time as astro;
    let tai = match query.input.ok_or(ProtocolError::MissingField)? {
        p::time_conversion_query::Input::Utc(value) => {
            let utc = decode_utc(value)?;
            astro::utc_to_tai(&utc).map_err(|_| ProtocolError::InvalidTime)?
        }
        p::time_conversion_query::Input::Instant(value) => {
            let instant = crate::decode_instant(value)?;
            match instant.scale() {
                "TAI" => astro::TaiInstant::from_time_instant(&instant),
                "TT" => astro::TtInstant::from_time_instant(&instant).and_then(astro::tt_to_tai),
                "TDB" => astro::TdbInstant::from_time_instant(&instant)
                    .and_then(astro::tdb_to_tt)
                    .and_then(astro::tt_to_tai),
                _ => return Err(ProtocolError::UnsupportedTimeScale),
            }
            .map_err(|_| ProtocolError::InvalidTime)?
        }
    };
    let utc = astro::tai_to_utc(tai).map_err(|_| ProtocolError::InvalidTime)?;
    let tt = astro::tai_to_tt(tai);
    let tdb = astro::tt_to_tdb(tt);
    let tt_minus_utc = astro::tt_minus_utc_nanos(&utc).map_err(|_| ProtocolError::InvalidTime)?;
    Ok(p::TimeConversion {
        utc: Some(encode_utc(utc)),
        tdb: Some(encode_instant(
            &tdb.to_time_instant()
                .map_err(|_| ProtocolError::InvalidTime)?,
        )?),
        tt: Some(encode_instant(
            &tt.to_time_instant()
                .map_err(|_| ProtocolError::InvalidTime)?,
        )?),
        tai: Some(encode_instant(
            &tai.to_time_instant()
                .map_err(|_| ProtocolError::InvalidTime)?,
        )?),
        tt_minus_utc_nanos: i64::try_from(tt_minus_utc).map_err(|_| ProtocolError::InvalidTime)?,
        predicted: astro::is_predicted_utc(&utc),
        utc_regime: encode_utc_regime(astro::utc_regime(&utc)) as i32,
    })
}

fn dyno_time(instant: &spaceeyes_time::TimeInstant) -> Result<f64, ProtocolError> {
    if instant.scale() != "TDB" || instant.epoch() != "J2000" {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(instant.seconds() as f64 + f64::from(instant.nanos()) / 1_000_000_000.0)
}

fn dyno_instant(seconds: f64) -> Result<p::TimeInstant, ProtocolError> {
    if !seconds.is_finite() {
        return Err(ProtocolError::InvalidContext);
    }
    let floor = seconds.floor();
    let mut nanos = ((seconds - floor) * 1_000_000_000.0).round();
    let mut whole = floor;
    if nanos >= 1_000_000_000.0 {
        nanos -= 1_000_000_000.0;
        whole += 1.0;
    }
    if whole < i64::MIN as f64 || whole > i64::MAX as f64 {
        return Err(ProtocolError::InvalidContext);
    }
    Ok(p::TimeInstant {
        time_scale: p::TimeScale::Tdb as i32,
        epoch_id: "J2000".into(),
        seconds: whole as i64,
        nanos: nanos as u32,
    })
}

fn dyno_range(interval: spaceeyes_dynamo::DynInterval) -> Result<p::TimeRange, ProtocolError> {
    Ok(p::TimeRange {
        start: Some(dyno_instant(interval.min)?),
        end: Some(dyno_instant(interval.max)?),
        include_start: true,
        include_end: true,
    })
}

fn dyno_status(reason: spaceeyes_astro::EvaluationReason) -> p::DynamoStatus {
    match reason {
        spaceeyes_astro::EvaluationReason::OutOfRange => p::DynamoStatus::OutOfRange,
        spaceeyes_astro::EvaluationReason::InvalidSamples => p::DynamoStatus::InvalidSamples,
        spaceeyes_astro::EvaluationReason::UnsupportedOrbit => p::DynamoStatus::UnsupportedOrbit,
    }
}

fn dyno_body(value: i32) -> Result<Option<spaceeyes_astro::Body>, ProtocolError> {
    match p::DynamoBody::try_from(value) {
        Ok(p::DynamoBody::Unspecified) => Ok(None),
        Ok(p::DynamoBody::Primary) => Ok(Some(spaceeyes_astro::Body::Primary)),
        Ok(p::DynamoBody::Secondary) => Ok(Some(spaceeyes_astro::Body::Secondary)),
        Err(_) => Err(ProtocolError::InvalidContext),
    }
}

struct DynWindow {
    point_type: spaceeyes_dynamo::PointType,
    points: Vec<spaceeyes_astro::EphemerisPoint>,
    interval: spaceeyes_astro::Interval,
    masses: Option<spaceeyes_astro::MassParameters>,
    source: Option<spaceeyes_resources::UploadSource>,
}

fn read_dyn_window(
    engine: &spaceeyes_engine::Engine,
    id: &spaceeyes_foundation::ResourceId,
) -> Result<DynWindow, ProtocolError> {
    let bytes = engine
        .ready_resource_bytes(id)
        .map_err(|_| ProtocolError::ResourceUnavailable)?;
    let file = spaceeyes_dynamo::parse_dyn(&bytes).map_err(|_| ProtocolError::InvalidContext)?;
    let interval = file.interval.ok_or(ProtocolError::InvalidContext)?;
    let source = engine.resource_source(id);
    let masses =
        file.header
            .gravitational_parameters
            .map(|parameters| spaceeyes_astro::MassParameters {
                primary: parameters.mu1,
                secondary: parameters.mu2,
            });
    Ok(DynWindow {
        point_type: file.header.point_type,
        points: file.points,
        interval,
        masses,
        source,
    })
}

fn evaluate_dynamo(
    engine: &spaceeyes_engine::Engine,
    query: p::EvaluateDynamoQuery,
) -> Result<p::DynamoState, ProtocolError> {
    use spaceeyes_astro::{EvaluationKind, EvaluationState};
    use spaceeyes_dynamo::PointType;
    let position_id = query.position.map(crate::decode_resource_id).transpose()?;
    let orientation_id = query
        .orientation
        .map(crate::decode_resource_id)
        .transpose()?;
    if position_id.is_none() && orientation_id.is_none() {
        return Err(ProtocolError::InvalidContext);
    }
    let instant = crate::decode_instant(query.instant.ok_or(ProtocolError::MissingField)?)?;
    let time = dyno_time(&instant)?;
    let body = dyno_body(query.body)?;

    let mut status = p::DynamoStatus::Ready;
    let mut position_m = None;
    let mut velocity_mps = None;
    let mut orientation = None;
    let mut angular_velocity = None;
    let mut coverage = None;
    let mut source = None;

    if let Some(id) = position_id {
        let window = read_dyn_window(engine, &id)?;
        if !matches!(
            window.point_type,
            PointType::Orb | PointType::Pos | PointType::Lin
        ) {
            return Err(ProtocolError::InvalidContext);
        }
        let state =
            spaceeyes_astro::evaluate(&window.points, window.interval, time, body, window.masses);
        coverage = Some(dyno_range(window.interval)?);
        source = window.source;
        match state {
            EvaluationState::Ready(EvaluationKind::Position { position, velocity }) => {
                position_m = Some(p::Vector3d {
                    x: position.x * 1000.0,
                    y: position.y * 1000.0,
                    z: position.z * 1000.0,
                });
                velocity_mps = Some(p::Vector3d {
                    x: velocity.x * 1000.0,
                    y: velocity.y * 1000.0,
                    z: velocity.z * 1000.0,
                });
            }
            EvaluationState::Unavailable(reason) => status = dyno_status(reason),
            EvaluationState::Ready(EvaluationKind::Orientation { .. }) => {
                return Err(ProtocolError::InvalidContext)
            }
        }
    }

    if let Some(id) = orientation_id {
        let window = read_dyn_window(engine, &id)?;
        if !matches!(window.point_type, PointType::Ori | PointType::Quat) {
            return Err(ProtocolError::InvalidContext);
        }
        let state =
            spaceeyes_astro::evaluate(&window.points, window.interval, time, None, window.masses);
        if coverage.is_none() {
            coverage = Some(dyno_range(window.interval)?);
        }
        if source.is_none() {
            source = window.source;
        }
        match state {
            EvaluationState::Ready(EvaluationKind::Orientation {
                orientation: value,
                angular_velocity: angular,
            }) => {
                orientation = Some(p::Quaterniond {
                    w: value.w,
                    x: value.x,
                    y: value.y,
                    z: value.z,
                });
                angular_velocity = Some(p::Vector3d {
                    x: angular.x,
                    y: angular.y,
                    z: angular.z,
                });
            }
            EvaluationState::Unavailable(reason) => {
                if status == p::DynamoStatus::Ready {
                    status = dyno_status(reason);
                }
            }
            EvaluationState::Ready(EvaluationKind::Position { .. }) => {
                return Err(ProtocolError::InvalidContext)
            }
        }
    }

    let (source_id, source_version) = source
        .map(|value| (value.source_id, value.source_version))
        .unwrap_or_default();
    Ok(p::DynamoState {
        status: status as i32,
        position_m,
        velocity_mps,
        orientation,
        angular_velocity_radps: angular_velocity,
        coverage,
        source_id,
        source_version,
    })
}

fn evaluate_dynamo_orbit(
    engine: &spaceeyes_engine::Engine,
    query: p::DynamoOrbitQuery,
) -> Result<p::DynamoOrbit, ProtocolError> {
    let id = crate::decode_resource_id(query.resource.ok_or(ProtocolError::MissingField)?)?;
    let instant = crate::decode_instant(query.instant.ok_or(ProtocolError::MissingField)?)?;
    let time = dyno_time(&instant)?;
    let samples = if query.samples == 0 {
        160
    } else {
        query.samples
    };
    let window = read_dyn_window(engine, &id)?;
    if window.point_type != spaceeyes_dynamo::PointType::Orb {
        return Err(ProtocolError::InvalidContext);
    }
    let line = spaceeyes_astro::orbit_polyline(&window.points, window.interval, time, samples)
        .map_err(|_| ProtocolError::InvalidContext)?;
    let (source_id, source_version) = window
        .source
        .map(|value| (value.source_id, value.source_version))
        .unwrap_or_default();
    Ok(p::DynamoOrbit {
        points_m: line
            .iter()
            .map(|point| p::Vector3d {
                x: point.x * 1000.0,
                y: point.y * 1000.0,
                z: point.z * 1000.0,
            })
            .collect(),
        closed: true,
        coverage: Some(dyno_range(window.interval)?),
        source_id,
        source_version,
    })
}

impl ProtocolAdapter {
    /// Host must supply an authenticated, authorized principal; this only validates shape/session.
    pub fn query_bytes(
        &self,
        principal_scope: &str,
        bytes: &[u8],
    ) -> Result<Vec<u8>, ProtocolError> {
        if bytes.len() > crate::limits::MAX_MESSAGE_BYTES {
            return Err(ProtocolError::MessageTooLarge);
        }
        let envelope =
            p::QueryEnvelope::decode(bytes).map_err(|_| ProtocolError::InvalidContext)?;
        let id = envelope
            .context
            .as_ref()
            .map(|c| c.request_id.clone())
            .unwrap_or_default();
        let result = self.query_envelope(principal_scope, envelope);
        let response = match result {
            Ok(r) => r,
            Err(error) => {
                let code = match error {
                    ProtocolError::UnsupportedVersion => p::ErrorCode::UnsupportedVersion,
                    ProtocolError::ResourceUnavailable => p::ErrorCode::ProviderUnavailable,
                    _ => p::ErrorCode::InvalidArgument,
                };
                rejection(&id, code, format!("{error:?}"))
            }
        };
        Ok(response.encode_to_vec())
    }
    fn query_envelope(
        &self,
        principal_scope: &str,
        envelope: p::QueryEnvelope,
    ) -> Result<p::ResponseEnvelope, ProtocolError> {
        let context = envelope.context.ok_or(ProtocolError::MissingField)?;
        validate_wire_context(&context)?;
        let dispatcher = self.dispatcher();
        if let Err(error) =
            dispatcher.validate_context(&context.session_id, principal_scope, &context.request_id)
        {
            return Ok(rejection(
                &context.request_id,
                dispatch_error_code(&error),
                format!("{error:?}"),
            ));
        }
        let state = dispatcher.session_status();
        if context
            .time_generation
            .is_some_and(|g| g != state.clock.generation.0)
        {
            return Ok(rejection(
                &context.request_id,
                p::ErrorCode::StaleGeneration,
                "stale time generation".into(),
            ));
        }
        if context
            .expected_scene_revision
            .is_some_and(|r| r != state.scene_revision.0)
        {
            return Ok(rejection(
                &context.request_id,
                p::ErrorCode::RevisionConflict,
                "scene revision conflict".into(),
            ));
        }
        let payload = match envelope.payload.ok_or(ProtocolError::MissingField)? {
            p::query_envelope::Payload::Upload(q) => {
                crate::uploads::validate_upload_id(&q.upload_id)?;
                match dispatcher
                    .engine()
                    .upload_status(principal_scope, &q.upload_id)
                {
                    Ok(upload) => p::response_envelope::Payload::Upload(
                        crate::uploads::encode_status(&upload),
                    ),
                    Err(error) => {
                        return Ok(rejection(
                            &context.request_id,
                            dispatch_error_code(&spaceeyes_engine::DispatchError::Resource(
                                error.clone(),
                            )),
                            format!("{error:?}"),
                        ))
                    }
                }
            }
            p::query_envelope::Payload::ResourceStats(_) => {
                let usage = dispatcher.engine().resource_usage();
                let limits = dispatcher.engine().resource_limits();
                p::response_envelope::Payload::ResourceStats(p::ResourceStats {
                    total_used_bytes: usage.total_bytes,
                    cpu_used_bytes: usage.cpu_bytes,
                    gpu_used_bytes: usage.gpu_bytes,
                    staging_used_bytes: usage.staging_bytes,
                    total_limit_bytes: limits.total_bytes,
                    cpu_limit_bytes: limits.cpu_bytes,
                    gpu_limit_bytes: limits.gpu_bytes,
                    staging_limit_bytes: limits.staging_bytes,
                    resource_revision: state.resource_revision,
                })
            }
            p::query_envelope::Payload::CameraState(query) => {
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                let id = crate::decode_object_id(query.camera.ok_or(ProtocolError::MissingField)?)?;
                let object = match dispatcher.engine().scene().get(&id) {
                    Some(o) if o.camera().is_some() => o,
                    _ => {
                        return Ok(rejection(
                            &context.request_id,
                            p::ErrorCode::UnknownObject,
                            "camera unavailable".into(),
                        ))
                    }
                };
                p::response_envelope::Payload::Camera(p::CameraInfo {
                    camera: Some(p::ObjectId {
                        value: id.as_str().into(),
                    }),
                    reference: object.frame().map(|id| p::FrameId {
                        value: id.as_str().into(),
                    }),
                    state: object.camera().map(crate::dispatch::encode_camera),
                })
            }
            p::query_envelope::Payload::PickPresented(query) => {
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                let object = match dispatcher.pick_presented(query.frame_sequence, query.x, query.y)
                {
                    Ok(object) => object,
                    Err(error) => {
                        return Ok(rejection(
                            &context.request_id,
                            if error == spaceeyes_rendering::RenderError::StalePick {
                                p::ErrorCode::SnapshotExpired
                            } else {
                                p::ErrorCode::InvalidArgument
                            },
                            format!("{error:?}"),
                        ))
                    }
                };
                p::response_envelope::Payload::Selection(p::PresentedSelection {
                    frame_sequence: query.frame_sequence,
                    scene_revision: state.scene_revision.0,
                    object: object.map(|o| {
                        Box::new(p::SceneObject {
                            object_id: Some(p::ObjectId {
                                value: o.id().as_str().into(),
                            }),
                            parent_id: o.parent().map(|id| p::ObjectId {
                                value: id.as_str().into(),
                            }),
                            frame_id: o.frame().map(|id| p::FrameId {
                                value: id.as_str().into(),
                            }),
                            visible: o.visible(),
                            lifecycle: p::ObjectLifecycle::Active as i32,
                            resources: o
                                .resource_refs()
                                .into_iter()
                                .map(|id| p::ResourceId {
                                    value: id.as_str().into(),
                                })
                                .collect(),
                            camera: o.camera().map(crate::dispatch::encode_camera),
                            sphere: o.sphere().map(crate::dispatch::encode_sphere),
                            mesh: o.mesh().map(crate::dispatch::encode_mesh_instance),
                            line: o.line().map(crate::dispatch::encode_line),
                            unresolved: false,
                        })
                    }),
                })
            }
            p::query_envelope::Payload::ListObjects(query) => {
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                if query.page_size > crate::limits::MAX_OBJECT_PAGE_SIZE {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::InvalidArgument,
                        "page size exceeds limit".into(),
                    ));
                }
                let limit = if query.page_size == 0 {
                    crate::limits::MAX_OBJECT_PAGE_SIZE as usize
                } else {
                    query.page_size as usize
                };
                let token = query.page_token.unwrap_or_default();
                if !token.is_empty()
                    && crate::decode_object_id(p::ObjectId {
                        value: token.clone(),
                    })
                    .is_err()
                {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::InvalidArgument,
                        "invalid page token".into(),
                    ));
                }
                let snapshot = dispatcher.engine().scene().snapshot();
                let mut objects: Vec<_> = snapshot
                    .objects
                    .into_iter()
                    .filter(|object| token.is_empty() || object.id().as_str() > token.as_str())
                    .collect();
                objects.sort_by(|left, right| left.id().as_str().cmp(right.id().as_str()));
                let next_page_token = if objects.len() > limit {
                    let next = objects[limit - 1].id().as_str().to_owned();
                    objects.truncate(limit);
                    next
                } else {
                    String::new()
                };
                p::response_envelope::Payload::Objects(p::ObjectPage {
                    objects: objects
                        .iter()
                        .map(crate::project::encode_scene_object)
                        .collect::<Result<_, _>>()?,
                    next_page_token,
                    scene_revision: snapshot.revision.0,
                })
            }
            p::query_envelope::Payload::ProjectExport(_) => {
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                p::response_envelope::Payload::Project(crate::encode_project(
                    &dispatcher.engine().project_state(),
                )?)
            }
            p::query_envelope::Payload::Capabilities(_) => {
                use crate::limits::*;
                p::response_envelope::Payload::Capabilities(p::Capabilities {
                    protocol_version: Some(p::ProtocolVersion {
                        major: PROTOCOL_MAJOR,
                        minor: PROTOCOL_MINOR,
                        schema_id: SCHEMA_ID.into(),
                    }),
                    operations: OPERATIONS.iter().map(|s| (*s).into()).collect(),
                    browser_surface: cfg!(all(feature = "gpu", target_arch = "wasm32")),
                    limits: Some(p::ProtocolLimits {
                        max_message_bytes: MAX_MESSAGE_BYTES as u32,
                        max_identifier_bytes: MAX_IDENTIFIER_BYTES as u32,
                        max_scene_commands: MAX_SCENE_COMMANDS as u32,
                        max_object_resources: MAX_OBJECT_RESOURCES as u32,
                        max_texture_dimension: spaceeyes_geometry::MAX_TEXTURE_DIMENSION,
                        max_mesh_vertices: spaceeyes_geometry::MAX_VERTICES as u32,
                        max_mesh_indices: spaceeyes_geometry::MAX_INDICES as u32,
                        max_canvas_dimension: spaceeyes_rendering::MAX_CANVAS_DIMENSION,
                        max_frame_elapsed_nanos: spaceeyes_rendering::MAX_FRAME_ELAPSED_NANOS,
                        max_resource_total_bytes: dispatcher.engine().resource_limits().total_bytes,
                        max_resource_cpu_bytes: dispatcher.engine().resource_limits().cpu_bytes,
                        max_resource_gpu_bytes: dispatcher.engine().resource_limits().gpu_bytes,
                        max_resource_staging_bytes: dispatcher
                            .engine()
                            .resource_limits()
                            .staging_bytes,
                        max_upload_bytes: spaceeyes_resources::MAX_UPLOAD_BYTES,
                        max_upload_chunk_bytes: spaceeyes_resources::MAX_UPLOAD_CHUNK_BYTES as u32,
                        max_active_uploads: spaceeyes_resources::MAX_UPLOAD_SESSIONS as u32,
                        max_encoded_image_bytes: spaceeyes_resources::MAX_ENCODED_IMAGE_BYTES
                            as u64,
                        command_history_capacity: dispatcher.command_history_capacity() as u64,
                        command_history_remaining: dispatcher.command_history_remaining() as u64,
                    }),
                })
            }
            p::query_envelope::Payload::Events(query) => {
                let max = if query.max_events == 0 {
                    crate::limits::MAX_EVENT_PAGE as usize
                } else {
                    query.max_events as usize
                };
                match dispatcher.events_after(query.after_sequence, max) {
                    Ok(page) => p::response_envelope::Payload::Events(encode_event_page(&page)),
                    Err(error) => {
                        return Ok(rejection(
                            &context.request_id,
                            dispatch_error_code(&error),
                            format!("{error:?}"),
                        ))
                    }
                }
            }
            p::query_envelope::Payload::FrameCoverage(query) => {
                let frame =
                    crate::decode_frame_id(query.frame.ok_or(ProtocolError::MissingField)?)?;
                match dispatcher.engine().spatial().coverage(&frame) {
                    Ok(coverage) => {
                        let (covered, start, end, provider_id, provider_version) = match coverage {
                            Some(range) => (
                                true,
                                Some(encode_instant(&range.start)?),
                                Some(encode_instant(&range.end)?),
                                range.provider_id,
                                range.provider_version,
                            ),
                            None => (false, None, None, String::new(), String::new()),
                        };
                        p::response_envelope::Payload::FrameCoverage(p::FrameCoverage {
                            frame: Some(p::FrameId {
                                value: frame.as_str().into(),
                            }),
                            covered,
                            start,
                            end,
                            provider_id,
                            provider_version,
                        })
                    }
                    Err(spaceeyes_spatial::SpatialError::UnknownFrame) => {
                        return Ok(rejection(
                            &context.request_id,
                            p::ErrorCode::UnknownFrame,
                            "unknown frame".into(),
                        ))
                    }
                    Err(error) => {
                        return Ok(rejection(
                            &context.request_id,
                            p::ErrorCode::InvalidArgument,
                            format!("{error:?}"),
                        ))
                    }
                }
            }
            p::query_envelope::Payload::TimeConversion(query) => {
                p::response_envelope::Payload::TimeConversion(convert_time(query)?)
            }
            p::query_envelope::Payload::EvaluateDynamo(query) => {
                p::response_envelope::Payload::Dynamo(evaluate_dynamo(dispatcher.engine(), query)?)
            }
            p::query_envelope::Payload::DynamoOrbit(query) => {
                p::response_envelope::Payload::DynamoOrbit(evaluate_dynamo_orbit(
                    dispatcher.engine(),
                    query,
                )?)
            }
            p::query_envelope::Payload::SessionStatus(_) => {
                p::response_envelope::Payload::Session(encode_status(&state)?)
            }
            p::query_envelope::Payload::ResolveFrame(query) => {
                let source = decode_frame_id(query.source.ok_or(ProtocolError::MissingField)?)?;
                let target = decode_frame_id(query.target.ok_or(ProtocolError::MissingField)?)?;
                if state.lifecycle == EngineState::Stopped {
                    return Ok(rejection(
                        &context.request_id,
                        p::ErrorCode::EngineUnavailable,
                        "engine stopped".into(),
                    ));
                }
                let transform =
                    match dispatcher
                        .engine()
                        .resolve_frame(&source, &target, &state.clock.instant)
                    {
                        Ok(t) => t,
                        Err(error) => {
                            return Ok(rejection(
                                &context.request_id,
                                dispatch_error_code(&spaceeyes_engine::DispatchError::Spatial(
                                    error.clone(),
                                )),
                                format!("{error:?}"),
                            ))
                        }
                    };
                p::response_envelope::Payload::Frame(p::FrameResolution {
                    source: Some(p::FrameId {
                        value: source.as_str().into(),
                    }),
                    target: Some(p::FrameId {
                        value: target.as_str().into(),
                    }),
                    instant: Some(encode_instant(&state.clock.instant)?),
                    transform: Some(encode_transform(transform)),
                    frame_graph_revision: state.frame_graph_revision.0,
                })
            }
        };
        Ok(p::ResponseEnvelope {
            request_id: context.request_id,
            status: p::ResponseStatus::Completed as i32,
            payload: Some(payload),
            command_sequence: dispatcher.command_sequence(),
            committed_scene_revision: state.scene_revision.0,
            frame_sequence: state.frame_sequence,
        })
    }
}
