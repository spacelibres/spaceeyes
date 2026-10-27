//! Synchronous command ordering and bounded idempotency, owned at the Engine boundary.
use crate::{Engine, EngineSnapshot};
use spaceeyes_foundation::{CoreError, Revision};
use spaceeyes_scene::SceneCommand;
use spaceeyes_time::{TimeGeneration, TimeInstant};
use std::collections::{BTreeMap, VecDeque};
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Scene {
        expected_revision: Revision,
        commands: Vec<SceneCommand>,
    },
    Play,
    Pause,
    SetRate(spaceeyes_time::PlaybackRate),
    Seek(TimeInstant),
    Step(i128),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchError {
    InvalidContext,
    WrongSession,
    IdempotencyConflict,
    HistoryFull,
    Overflow,
    StaleGeneration,
    Domain(CoreError),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommandReceipt {
    pub command_sequence: u64,
    pub frame_sequence: u64,
    pub scene_revision: Revision,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommitEvent {
    pub command_sequence: u64,
    pub request_id: String,
    pub receipt: CommandReceipt,
}
#[derive(Clone)]
struct Record {
    command: Command,
    generation: Option<TimeGeneration>,
    result: Result<CommandReceipt, DispatchError>,
}
pub struct CommandDispatcher {
    engine: Engine,
    session: String,
    capacity: usize,
    sequence: u64,
    history: BTreeMap<(String, String), Record>,
    events: VecDeque<CommitEvent>,
}
impl CommandDispatcher {
    pub fn new(engine: Engine, session: String, capacity: usize) -> Result<Self, DispatchError> {
        if session.trim().is_empty() || capacity == 0 {
            return Err(DispatchError::InvalidContext);
        }
        Ok(Self {
            engine,
            session,
            capacity,
            sequence: 0,
            history: BTreeMap::new(),
            events: VecDeque::new(),
        })
    }
    pub fn engine(&self) -> &Engine {
        &self.engine
    }
    pub fn snapshot(&self) -> EngineSnapshot {
        self.engine.snapshot()
    }
    pub fn events(&self) -> impl Iterator<Item = &CommitEvent> {
        self.events.iter()
    }
    pub fn submit(
        &mut self,
        session: &str,
        principal_scope: &str,
        request_id: &str,
        command: Command,
    ) -> Result<CommandReceipt, DispatchError> {
        self.submit_with_generation(session, principal_scope, request_id, None, command)
    }
    pub fn submit_with_generation(
        &mut self,
        session: &str,
        principal_scope: &str,
        request_id: &str,
        generation: Option<TimeGeneration>,
        command: Command,
    ) -> Result<CommandReceipt, DispatchError> {
        if session != self.session {
            return Err(DispatchError::WrongSession);
        }
        if principal_scope.trim().is_empty()
            || request_id.trim().is_empty()
            || request_id.len() > 256
            || principal_scope.len() > 256
        {
            return Err(DispatchError::InvalidContext);
        }
        let key = (principal_scope.to_owned(), request_id.to_owned());
        if let Some(record) = self.history.get(&key) {
            return if record.command == command && record.generation == generation {
                record.result.clone()
            } else {
                Err(DispatchError::IdempotencyConflict)
            };
        }
        if self.history.len() >= self.capacity {
            return Err(DispatchError::HistoryFull);
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .ok_or(DispatchError::Overflow)?;
        let result = if generation.is_some_and(|g| g != self.engine.clock().generation()) {
            Err(DispatchError::StaleGeneration)
        } else {
            match &command {
                Command::Scene {
                    expected_revision,
                    commands,
                } => self
                    .engine
                    .submit_scene(*expected_revision, commands)
                    .map(|_| ()),
                Command::SetRate(rate) => self.engine.set_rate(*rate),
                Command::Play => self.engine.play(),
                Command::Pause => self.engine.pause(),
                Command::Seek(t) => self.engine.seek(t.clone()),
                Command::Step(n) => self.engine.step_nanos(*n),
            }
            .map_err(DispatchError::Domain)
        }
        .map(|()| CommandReceipt {
            command_sequence: sequence,
            frame_sequence: self.engine.snapshot().sequence,
            scene_revision: self.engine.scene().revision(),
        });
        self.sequence = sequence;
        if let Ok(receipt) = &result {
            if self.events.len() == self.capacity {
                self.events.pop_front();
            }
            self.events.push_back(CommitEvent {
                command_sequence: sequence,
                request_id: request_id.to_owned(),
                receipt: receipt.clone(),
            });
        }
        self.history.insert(
            key,
            Record {
                command,
                generation,
                result: result.clone(),
            },
        );
        result
    }
}
