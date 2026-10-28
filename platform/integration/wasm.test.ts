import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PluginHost, type PluginContext } from '../plugin-host.ts';
import { WasmCorePort } from '../wasm-core-port.ts';

// Intentionally requires a freshly built real Rust WASM artifact, with no stub fallback.
const { WasmCore } = createRequire(import.meta.url)('../../core/pkg/spaceeyes_core.js');

test('TS plugin drives real Rust WASM state, clock, focus and session cleanup', async () => {
  const core = new WasmCore();
  const host = new PluginHost(new WasmCorePort(core));
  let sdk!: PluginContext;
  try {
    host.register({ id: 'integration.source', apiVersion: 1,
      capabilities: ['camera.control', 'data.publish', 'time.control'] }, context => { sdk = context; });
    await host.enable('integration.source', ['camera.control', 'data.publish', 'time.control']);
    sdk.data.publish('body:test', { positionKm: [1e12, 2, 3], radiusKm: 1, epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 10], frame: 'ICRF', source: 'synthetic integration fixture' });
    assert.equal(JSON.parse(core.state_at('body:test', 0)).positionKm[0], 1e12);
    sdk.camera.focus('body:test');
    assert.equal(core.focused_object(), 'body:test');
    sdk.time.setPlayback(true, 2);
    core.tick(1);
    assert.equal(core.epoch(), 2);
    assert.throws(() => core.state_at('body:test', 2), /StaleState/);
    await host.disable('integration.source');
    assert.equal(core.focused_object(), undefined);
    assert.equal(core.playing(), false);
    assert.throws(() => core.state_at('body:test', 0), /UnknownObject/);
    assert.throws(() => sdk.camera.focus('body:test'), /inactive/);
  } finally { core.free(); }
});

test('actual WASM boundary independently rejects spoofed identity and invalid JSON', () => {
  const core = new WasmCore();
  try {
    core.open_session('session-a', 'one.plugin', true, true, false);
    assert.throws(() => core.publish_object('session-a', 'one.plugin', 'body:test', '{bad json'), /InvalidState/);
    const sample = JSON.stringify({ positionKm: [1, 2, 3], radiusKm: 1, epochTdbSeconds: 0,
      coverageTdbSeconds: [0, 1], frame: 'ICRF', source: 'test' });
    assert.throws(() => core.publish_object('session-a', 'spoofed.plugin', 'body:test', sample), /WrongOwner/);
    core.release_session('session-a');
    assert.throws(() => core.focus('session-a', 'one.plugin', 'body:test'), /InactiveSession/);
  } finally { core.free(); }
});
