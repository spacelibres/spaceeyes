import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginHost, type PluginContext } from '../plugin-host.ts';
import type { ObjectState } from '../state-contract.ts';
import { snapshotState } from '../state-contract.ts';

const sample = (): ObjectState => ({ positionKm: [1e12, 0, 0], radiusKm: 10,
  epochTdbSeconds: 0, coverageTdbSeconds: [0, 10], frame: 'ICRF', source: 'fixture:test' });

test('data and time SDK forward immutable samples through host-owned sessions', async () => {
  const received: ObjectState[] = [];
  const actions: unknown[] = [];
  let context!: PluginContext;
  const host = new PluginHost({ openSession: request => { actions.push(request); }, focus: () => {}, releaseSession: () => {},
    publishObject: request => { received.push(request.state); },
    removeObject: request => { actions.push(request.targetId); },
    seek: request => { actions.push(request.epochTdbSeconds); },
    setPlayback: request => { actions.push(request.rate); },
  });
  host.register({ id: 'example.source', apiVersion: 1, capabilities: ['data.publish', 'time.control'] }, sdk => { context = sdk; });
  await host.enable('example.source', ['data.publish', 'time.control']);
  const state = sample();
  context.data.publish('body:test', state);
  state.positionKm[0] = 0;
  assert.equal(received[0].positionKm[0], 1e12);
  assert.equal(Object.isFrozen(received[0].positionKm), true);
  context.data.remove('body:test');
  context.time.seek(10);
  context.time.setPlayback(true, -2);
  assert.deepEqual(actions.slice(1), ['body:test', 10, -2]);
  assert.throws(() => context.data.publish('body:test', { ...sample(), radiusKm: -1 }), /state/);
  assert.throws(() => context.time.seek(NaN), /time/);
  await host.disable('example.source');
  assert.throws(() => context.data.publish('body:test', sample()), /inactive/);
  assert.throws(() => context.time.seek(0), /inactive/);
});

test('declared data capability does not grant time or bypass missing adapters', async () => {
  let context!: PluginContext;
  const host = new PluginHost();
  host.register({ id: 'example.source', apiVersion: 1, capabilities: ['data.publish'] }, sdk => { context = sdk; });
  await host.enable('example.source', ['data.publish']);
  assert.throws(() => context.data.publish('body:test', sample()), /unavailable/);
  assert.throws(() => context.time.seek(0), /permission/);
  await host.disable('example.source');
});

test('sparse or nonfinite coordinates cannot pass the runtime state boundary', () => {
  const sparse = sample();
  sparse.positionKm = new Array(3) as [number, number, number];
  assert.throws(() => snapshotState(sparse), /state/);
  const invalid = sample();
  invalid.coverageTdbSeconds = new Array(2) as [number, number];
  assert.throws(() => snapshotState(invalid), /state/);
});
