// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
//! Native worker pool for issued simulation tasks.
//!
//! The pool owns bounded queueing, priority order, cooperative cancellation and a
//! wall-clock deadline. It never mutates Scene and it never commits results; the
//! Engine still validates every outcome through the scheduler state machine.
//! Arbitrary blocking host work cannot be preempted by a Rust thread, so a timeout
//! reports failure and rejects the late outcome instead of claiming a kill.
use crate::{IssuedTask, TaskError, TaskExecutionToken, TaskExecutor, TaskPriority};
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Host-provided bounded work. Implementations must poll the control handle and
/// return promptly; the pool records cancellation even if the work does not stop.
pub trait TaskWork: Send + Sync + 'static {
    fn work(&self, task: &IssuedTask, control: &ExecutionControl) -> Result<(), TaskError>;
}

/// Shared cancellation flag and deadline for one dispatched task.
#[derive(Clone, Debug)]
pub struct ExecutionControl {
    cancelled: Arc<AtomicBool>,
    deadline: Instant,
}
impl ExecutionControl {
    pub fn cancelled(&self) -> bool {
        self.cancelled.load(AtomicOrdering::Acquire)
    }
    pub fn remaining(&self) -> Duration {
        self.deadline.saturating_duration_since(Instant::now())
    }
    /// Cooperative checkpoint for long-running work.
    pub fn check(&self) -> Result<(), TaskError> {
        if self.cancelled() {
            return Err(TaskError::Cancelled);
        }
        if self.remaining().is_zero() {
            return Err(TaskError::Timeout);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorkerLimits {
    pub workers: usize,
    pub max_queue: usize,
    pub timeout: Duration,
}
impl WorkerLimits {
    pub fn new(workers: usize, max_queue: usize, timeout: Duration) -> Result<Self, TaskError> {
        if workers == 0 || max_queue == 0 || timeout.is_zero() {
            return Err(TaskError::InvalidBudget);
        }
        Ok(Self {
            workers,
            max_queue,
            timeout,
        })
    }
}

/// Terminal report from one worker. The Engine maps it into executor feedback;
/// tokens still decide whether the outcome may change any task.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkerOutcome {
    Completed(IssuedTask),
    Failed { task: IssuedTask, error: TaskError },
    Cancelled(IssuedTask),
    TimedOut(IssuedTask),
}
impl WorkerOutcome {
    pub fn task(&self) -> &IssuedTask {
        match self {
            Self::Completed(task) | Self::Cancelled(task) | Self::TimedOut(task) => task,
            Self::Failed { task, .. } => task,
        }
    }
}

struct Queued {
    priority: TaskPriority,
    sequence: u64,
    task: IssuedTask,
    cancel: Arc<AtomicBool>,
}
impl PartialEq for Queued {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority && self.sequence == other.sequence
    }
}
impl Eq for Queued {}
impl PartialOrd for Queued {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Queued {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap is a max-heap: higher priority first, then lower sequence.
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

struct Shared {
    queue: Mutex<BinaryHeap<Queued>>,
    ready: Condvar,
    queued: AtomicUsize,
    shutdown: AtomicBool,
}

pub struct WorkerPool {
    shared: Arc<Shared>,
    outcomes: Receiver<WorkerOutcome>,
    sender: Sender<WorkerOutcome>,
    workers: Vec<JoinHandle<()>>,
    limits: WorkerLimits,
    next_sequence: u64,
    cancels: Vec<(TaskExecutionToken, Arc<AtomicBool>)>,
}

impl WorkerPool {
    pub fn new(work: Arc<dyn TaskWork>, limits: WorkerLimits) -> Result<Self, TaskError> {
        let shared = Arc::new(Shared {
            queue: Mutex::new(BinaryHeap::new()),
            ready: Condvar::new(),
            queued: AtomicUsize::new(0),
            shutdown: AtomicBool::new(false),
        });
        let (sender, outcomes) = mpsc::channel();
        let mut workers = Vec::with_capacity(limits.workers);
        for index in 0..limits.workers {
            let shared = Arc::clone(&shared);
            let work = Arc::clone(&work);
            let sender = sender.clone();
            let handle = thread::Builder::new()
                .name(format!("spaceeyes-task-{index}"))
                .spawn(move || run_worker(&shared, work.as_ref(), &sender, limits.timeout))
                .map_err(|_| TaskError::InvalidBudget)?;
            workers.push(handle);
        }
        Ok(Self {
            shared,
            outcomes,
            sender,
            workers,
            limits,
            next_sequence: 0,
            cancels: Vec::new(),
        })
    }

    /// Queue one issued task at an explicit priority. Ordering is deterministic.
    pub fn dispatch_with_priority(
        &mut self,
        task: IssuedTask,
        priority: TaskPriority,
    ) -> Result<(), TaskError> {
        if self.shared.shutdown.load(AtomicOrdering::Acquire) {
            return Err(TaskError::InvalidState);
        }
        if self
            .shared
            .queued
            .fetch_update(AtomicOrdering::AcqRel, AtomicOrdering::Acquire, |count| {
                (count < self.limits.max_queue).then_some(count + 1)
            })
            .is_err()
        {
            return Err(TaskError::QueueFull);
        }
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels.push((task.token, Arc::clone(&cancel)));
        let job = Queued {
            priority,
            sequence,
            task,
            cancel,
        };
        self.shared
            .queue
            .lock()
            .expect("worker queue poisoned")
            .push(job);
        self.shared.ready.notify_one();
        Ok(())
    }

    /// Best-effort cooperative cancellation; a late outcome is still rejected.
    pub fn request_cancel_token(&mut self, token: &TaskExecutionToken) {
        self.cancels
            .iter()
            .filter(|(candidate, _)| candidate == token)
            .for_each(|(_, flag)| flag.store(true, AtomicOrdering::Release));
    }

    pub fn try_next_outcome(&mut self) -> Option<WorkerOutcome> {
        let outcome = self.outcomes.try_recv().ok()?;
        self.forget_cancelled(outcome.task().token);
        Some(outcome)
    }

    pub fn recv_timeout(&mut self, timeout: Duration) -> Option<WorkerOutcome> {
        let outcome = match self.outcomes.recv_timeout(timeout) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => return None,
        };
        self.forget_cancelled(outcome.task().token);
        Some(outcome)
    }

    fn forget_cancelled(&mut self, token: TaskExecutionToken) {
        self.cancels.retain(|(candidate, _)| candidate != &token);
    }

    pub fn queued_jobs(&self) -> usize {
        self.shared.queued.load(AtomicOrdering::Acquire)
    }

    pub fn limits(&self) -> WorkerLimits {
        self.limits
    }

    /// Stop accepting work, cancel everything outstanding, and join workers.
    /// Queued tasks that never started are reported Cancelled.
    pub fn close(&mut self) {
        if self.workers.is_empty() {
            return;
        }
        self.shared.shutdown.store(true, AtomicOrdering::Release);
        for (_, flag) in &self.cancels {
            flag.store(true, AtomicOrdering::Release);
        }
        self.shared.ready.notify_all();
        let drained: Vec<Queued> =
            std::mem::take(&mut *self.shared.queue.lock().expect("worker queue poisoned"))
                .into_vec();
        for job in drained {
            self.shared.queued.fetch_sub(1, AtomicOrdering::AcqRel);
            let _ = self.sender.send(WorkerOutcome::Cancelled(job.task));
        }
        for handle in self.workers.drain(..) {
            let _ = handle.join();
        }
    }
}

impl TaskExecutor for WorkerPool {
    fn dispatch(&mut self, task: IssuedTask) -> Result<(), TaskError> {
        self.dispatch_with_priority(task, TaskPriority::Normal)
    }
    fn request_cancel(&mut self, task: IssuedTask) -> Result<(), TaskError> {
        self.request_cancel_token(&task.token);
        Ok(())
    }
}

impl Drop for WorkerPool {
    fn drop(&mut self) {
        self.close();
    }
}

fn run_worker(
    shared: &Shared,
    work: &dyn TaskWork,
    sender: &Sender<WorkerOutcome>,
    timeout: Duration,
) {
    loop {
        let job = {
            let mut queue = shared.queue.lock().expect("worker queue poisoned");
            while queue.is_empty() && !shared.shutdown.load(AtomicOrdering::Acquire) {
                queue = shared.ready.wait(queue).expect("worker queue poisoned");
            }
            if shared.shutdown.load(AtomicOrdering::Acquire) {
                None
            } else {
                let job = queue.pop();
                if job.is_some() {
                    shared.queued.fetch_sub(1, AtomicOrdering::AcqRel);
                }
                job
            }
        };
        let Some(job) = job else {
            return;
        };
        let control = ExecutionControl {
            cancelled: Arc::clone(&job.cancel),
            deadline: Instant::now() + timeout,
        };
        let outcome = if control.cancelled() {
            WorkerOutcome::Cancelled(job.task)
        } else {
            match work.work(&job.task, &control) {
                Err(TaskError::Cancelled) => WorkerOutcome::Cancelled(job.task),
                Err(TaskError::Timeout) => WorkerOutcome::TimedOut(job.task),
                Err(error) => WorkerOutcome::Failed {
                    task: job.task,
                    error,
                },
                Ok(()) if control.cancelled() => WorkerOutcome::Cancelled(job.task),
                Ok(()) if control.remaining().is_zero() => WorkerOutcome::TimedOut(job.task),
                Ok(()) => WorkerOutcome::Completed(job.task),
            }
        };
        if sender.send(outcome).is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use spaceeyes_time::{TimeGeneration, TimeInstant};

    fn task(id: &str) -> IssuedTask {
        let mut scheduler = crate::SimulationScheduler::new();
        scheduler
            .enqueue(crate::TaskRequest {
                task_id: id.into(),
                generation: TimeGeneration(0),
                requested_instant: TimeInstant::new("TT", "epoch", 0, 0).unwrap(),
                dependencies: vec![],
            })
            .unwrap();
        scheduler.issued_task(id).unwrap()
    }

    #[derive(Default)]
    struct Probe {
        order: Mutex<Vec<String>>,
        gate: Mutex<bool>,
        gate_ready: Condvar,
    }
    impl Probe {
        fn started(&self, id: &str) -> bool {
            self.order.lock().unwrap().iter().any(|item| item == id)
        }
        fn release(&self) {
            *self.gate.lock().unwrap() = true;
            self.gate_ready.notify_all();
        }
        fn wait_for(&self, id: &str) {
            let deadline = Instant::now() + Duration::from_secs(2);
            while !self.started(id) {
                assert!(Instant::now() < deadline, "task {id} never started");
                thread::sleep(Duration::from_millis(1));
            }
        }
    }
    impl TaskWork for Probe {
        fn work(&self, task: &IssuedTask, control: &ExecutionControl) -> Result<(), TaskError> {
            let id = task.request.task_id.as_str();
            self.order.lock().unwrap().push(id.to_owned());
            match id {
                "hold" => {
                    let mut released = self.gate.lock().unwrap();
                    while !*released && !control.cancelled() && !control.remaining().is_zero() {
                        let (next, _) = self
                            .gate_ready
                            .wait_timeout(released, Duration::from_millis(5))
                            .unwrap();
                        released = next;
                    }
                    control.check()
                }
                "slow" => {
                    thread::sleep(Duration::from_millis(30));
                    Ok(())
                }
                "cancel" => {
                    while !control.cancelled() {
                        thread::sleep(Duration::from_millis(1));
                    }
                    control.check()
                }
                _ => control.check(),
            }
        }
    }

    fn pool(probe: Arc<Probe>, workers: usize, max_queue: usize, millis: u64) -> WorkerPool {
        WorkerPool::new(
            probe,
            WorkerLimits::new(workers, max_queue, Duration::from_millis(millis)).unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn priority_order_is_deterministic_for_queued_work() {
        let probe = Arc::new(Probe::default());
        let mut pool = pool(Arc::clone(&probe), 1, 8, 2000);
        pool.dispatch_with_priority(task("hold"), TaskPriority::Normal)
            .unwrap();
        probe.wait_for("hold");
        for (id, priority) in [
            ("prefetch", TaskPriority::Prefetch),
            ("interactive", TaskPriority::Interactive),
            ("normal", TaskPriority::Normal),
        ] {
            pool.dispatch_with_priority(task(id), priority).unwrap();
        }
        probe.release();
        let mut order = Vec::new();
        while order.len() < 4 {
            let outcome = pool.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(matches!(outcome, WorkerOutcome::Completed(_)));
            order.push(outcome.task().request.task_id.clone());
        }
        assert_eq!(order, ["hold", "interactive", "normal", "prefetch"]);
    }

    #[test]
    fn deadline_reports_timed_out_without_committing() {
        let probe = Arc::new(Probe::default());
        let mut pool = pool(Arc::clone(&probe), 1, 4, 5);
        pool.dispatch(task("slow")).unwrap();
        let outcome = pool.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(matches!(outcome, WorkerOutcome::TimedOut(_)));
    }

    #[test]
    fn cooperative_cancellation_reports_cancelled() {
        let probe = Arc::new(Probe::default());
        let mut pool = pool(Arc::clone(&probe), 1, 4, 2000);
        let cancel = task("cancel");
        pool.dispatch(cancel.clone()).unwrap();
        probe.wait_for("cancel");
        pool.request_cancel_token(&cancel.token);
        let outcome = pool.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(matches!(outcome, WorkerOutcome::Cancelled(_)));
        assert_eq!(pool.queued_jobs(), 0);
    }

    #[test]
    fn bounded_queue_rejects_excess_submissions() {
        let probe = Arc::new(Probe::default());
        let mut pool = pool(Arc::clone(&probe), 1, 1, 2000);
        pool.dispatch(task("hold")).unwrap();
        probe.wait_for("hold");
        pool.dispatch(task("a")).unwrap();
        assert_eq!(pool.dispatch(task("b")), Err(TaskError::QueueFull));
        probe.release();
        pool.close();
    }

    #[test]
    fn close_cancels_queued_and_running_work() {
        let probe = Arc::new(Probe::default());
        let mut pool = pool(Arc::clone(&probe), 1, 4, 2000);
        pool.dispatch(task("hold")).unwrap();
        probe.wait_for("hold");
        pool.dispatch(task("queued")).unwrap();
        pool.close();
        assert_eq!(pool.dispatch(task("late")), Err(TaskError::InvalidState));
        let mut cancelled = Vec::new();
        while let Some(outcome) = pool.try_next_outcome() {
            assert!(matches!(outcome, WorkerOutcome::Cancelled(_)));
            cancelled.push(outcome.task().request.task_id.clone());
        }
        assert!(cancelled.contains(&"queued".to_owned()));
        assert!(cancelled.contains(&"hold".to_owned()));
    }
}
