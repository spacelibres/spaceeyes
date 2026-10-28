import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginHost, type PluginContext } from '../plugin-host.ts';

test('registration is unique and enable/disable owns a fresh lifecycle', async () => {
  const host = new PluginHost();
  let starts = 0, stops = 0;
  host.register({ id: 'example.catalog', apiVersion: 1, capabilities: [] }, () => { starts++; return () => { stops++; }; });
  assert.throws(() => host.register({ id: 'example.catalog', apiVersion: 1, capabilities: [] }, () => {}), /duplicate/);
  await host.enable('example.catalog', []);
  await host.enable('example.catalog', []);
  assert.equal(starts, 1);
  assert.equal(host.status('example.catalog'), 'active');
  await host.disable('example.catalog');
  await host.disable('example.catalog');
  assert.equal(stops, 1);
  await host.enable('example.catalog', []);
  assert.equal(starts, 2);
  await host.disable('example.catalog');
});

test('capabilities require declaration, host approval and a live generation', async () => {
  const host = new PluginHost();
  let context!: PluginContext;
  host.register({ id: 'example.data', apiVersion: 1, capabilities: ['data.publish'] }, sdk => { context = sdk; });
  await assert.rejects(host.enable('example.data', []), /permission/);
  assert.equal(host.status('example.data'), 'registered');
  await host.enable('example.data', ['data.publish']);
  context.requireCapability('data.publish');
  assert.throws(() => context.requireCapability('camera.control'), /permission/);
  const old = context;
  await host.disable('example.data');
  assert.equal(old.signal.aborted, true);
  await host.enable('example.data', ['data.publish']);
  assert.throws(() => old.requireCapability('data.publish'), /inactive/);
  await host.disable('example.data');
});

test('activation failure aborts work and cleans resources in reverse order', async () => {
  const host = new PluginHost();
  const released: number[] = [];
  let signal!: AbortSignal;
  host.register({ id: 'example.broken', apiVersion: 1, capabilities: [] }, sdk => {
    signal = sdk.signal;
    sdk.onDispose(() => { released.push(1); });
    sdk.onDispose(() => { released.push(2); });
    throw new Error('activation failed');
  });
  await assert.rejects(host.enable('example.broken', []), /activation failed/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(released, [2, 1]);
  assert.equal(host.status('example.broken'), 'failed');
});

test('cleanup failure does not skip remaining cleanup or permit SDK calls', async () => {
  const host = new PluginHost();
  let context!: PluginContext;
  let cleaned = false;
  host.register({ id: 'example.cleanup', apiVersion: 1, capabilities: [] }, sdk => {
    context = sdk;
    sdk.onDispose(() => { cleaned = true; });
    sdk.onDispose(() => { throw new Error('release failed'); });
  });
  await host.enable('example.cleanup', []);
  await assert.rejects(host.disable('example.cleanup'), /cleanup/);
  assert.equal(cleaned, true);
  assert.equal(context.signal.aborted, true);
  assert.throws(() => context.onDispose(() => {}), /inactive/);
  assert.equal(host.status('example.cleanup'), 'failed');
});

test('overlapping lifecycle operations fail explicitly', async () => {
  const host = new PluginHost();
  let finish!: () => void;
  host.register({ id: 'example.async', apiVersion: 1, capabilities: [] }, () => new Promise<void>(resolve => { finish = resolve; }));
  const enabling = host.enable('example.async', []);
  await assert.rejects(host.disable('example.async'), /busy/);
  finish();
  await enabling;
  await host.disable('example.async');
});

test('invalid and incompatible manifests never activate', () => {
  const host = new PluginHost();
  for (const manifest of [
    { id: '../escape', apiVersion: 1, capabilities: [] },
    { id: 'example.version', apiVersion: 2, capabilities: [] },
    { id: 'example.unknown', apiVersion: 1, capabilities: ['arbitrary.internal'] },
  ]) assert.throws(() => host.register(manifest, () => {}), /manifest/);
});

test('camera SDK routes approved intent with host-owned identity and releases its session', async () => {
  const calls: Array<{ pluginId: string; sessionId: string; targetId: string }> = [];
  const released: string[] = [];
  const opened: string[] = [];
  const host = new PluginHost({
    openSession: request => { opened.push(request.sessionId); assert.equal(request.cameraControl, true); },
    focus: request => { calls.push(request); },
    releaseSession: sessionId => { released.push(sessionId); },
  });
  let context!: PluginContext;
  host.register({ id: 'example.camera', apiVersion: 1, capabilities: ['camera.control'] }, sdk => { context = sdk; });
  await host.enable('example.camera', ['camera.control']);
  context.camera.focus('body:mars');
  assert.equal(calls[0].pluginId, 'example.camera');
  assert.equal(calls[0].targetId, 'body:mars');
  assert.equal(opened[0], calls[0].sessionId);
  assert.throws(() => context.camera.focus(''), /target/);
  assert.equal(calls.length, 1);
  const old = context;
  await host.disable('example.camera');
  assert.deepEqual(released, [calls[0].sessionId]);
  await host.enable('example.camera', ['camera.control']);
  assert.throws(() => old.camera.focus('body:earth'), /inactive/);
  context.camera.focus('body:jupiter');
  assert.notEqual(calls[0].sessionId, calls[1].sessionId);
  await host.disable('example.camera');
});

test('camera SDK refuses undeclared authority and absent core adapters', async () => {
  let forwarded = false;
  const host = new PluginHost({ openSession: () => {}, focus: () => { forwarded = true; }, releaseSession: () => {} });
  let context!: PluginContext;
  host.register({ id: 'example.denied', apiVersion: 1, capabilities: [] }, sdk => { context = sdk; });
  await host.enable('example.denied', []);
  assert.throws(() => context.camera.focus('body:saturn'), /permission/);
  assert.equal(forwarded, false);
  await host.disable('example.denied');
  const detached = new PluginHost();
  detached.register({ id: 'example.detached', apiVersion: 1, capabilities: ['camera.control'] }, sdk => { context = sdk; });
  await detached.enable('example.detached', ['camera.control']);
  assert.throws(() => context.camera.focus('body:saturn'), /unavailable/);
  await detached.disable('example.detached');
});

test('host shutdown cleans all plugins, continues after failures and closes registration', async () => {
  const host = new PluginHost();
  const cleaned: string[] = [];
  host.register({ id: 'one.plugin', apiVersion: 1, capabilities: [] }, () => () => { cleaned.push('one'); throw new Error('failed cleanup'); });
  host.register({ id: 'two.plugin', apiVersion: 1, capabilities: [] }, () => () => { cleaned.push('two'); });
  await host.enable('one.plugin', []);
  await host.enable('two.plugin', []);
  await assert.rejects(host.shutdown(), /shutdown/);
  assert.deepEqual(cleaned, ['one', 'two']);
  await assert.rejects(host.enable('two.plugin', []), /closed/);
  assert.throws(() => host.register({ id: 'three.plugin', apiVersion: 1, capabilities: [] }, () => {}), /closed/);
  await assert.rejects(host.shutdown(), /shutdown/);
  assert.deepEqual(cleaned, ['one', 'two']);
});

test('shutdown invalidates and drains pending activation before releasing its core session', async () => {
  let finish!: () => void;
  let sdk!: PluginContext;
  let cleaned = 0;
  const host = new PluginHost();
  host.register({ id: 'async.plugin', apiVersion: 1, capabilities: [] }, async context => {
    sdk = context;
    await new Promise<void>(resolve => { finish = resolve; });
    return () => { cleaned++; };
  });
  const activation = host.enable('async.plugin', []);
  const shutdown = host.shutdown();
  assert.equal(sdk.signal.aborted, true);
  finish();
  await activation;
  await shutdown;
  assert.equal(cleaned, 1);
  assert.equal(host.status('async.plugin'), 'disabled');
});
