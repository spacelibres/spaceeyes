import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginHost, type PluginContext } from '../plugin-host.ts';
import type { VisualSpec } from '../visual-contract.ts';

test('timed trajectories validate ascending epochs and isolate caller mutation', async () => {
  let sdk!: PluginContext; let received: any;
  const host=new PluginHost({openSession(){},releaseSession(){},focus(){},trajectory(request){received=request;}});
  host.register({id:'example.timed',apiVersion:1,capabilities:['scene.visual']},ctx=>{sdk=ctx;});
  await host.enable('example.timed',['scene.visual']);
  const epochs=[0,10]; const points: [number,number,number][]=[[0,0,0],[1,1,0]];
  const color: [number,number,number,number]=[0.2,0.5,1,1];
  sdk.visual.trajectory('earth',points,epochs,{originId:'sun',colorRgba:color}); epochs[0]=100; points[0][0]=100; color[0]=1;
  assert.deepEqual(received.epochsTdbSeconds,[0,10]); assert.equal(received.points[0][0],0);
  assert.deepEqual(received.colorRgba,[0.2,0.5,1,1]); assert.equal(received.originId,'sun');
  assert.throws(()=>sdk.visual.trajectory('earth',[[0,0,0],[1,1,0]],[0,1],{colorRgba:[2,1,1,1]}),/color/);
  for(const invalid of [[10,0],[0,0],[0],[0,NaN]]) assert.throws(()=>sdk.visual.trajectory('earth',[[0,0,0],[1,1,0]],invalid),/epochs/);
  await host.shutdown();
});

test('visual SDK forwards immutable asset references using its own identity', async () => {
  const calls: unknown[] = [];
  let sdk!: PluginContext;
  const host = new PluginHost({ openSession: request => { assert.equal(request.visualControl, true); },
    focus: () => {}, releaseSession: () => {}, setVisual: request => { calls.push(request); },
    visualStatus: () => ({ revision: '1', phase: 'loading', detail: null }) });
  host.register({ id: 'example.visual', apiVersion: 1, capabilities: ['scene.visual'] }, context => { sdk = context; });
  await host.enable('example.visual', ['scene.visual']);
  const spec: VisualSpec = { kind: 'model', assetId: 'model:juno', scene: 0, scaleKmPerUnit: 0.001 };
  sdk.visual.set('object:test', spec);
  spec.assetId = 'other:model';
  assert.equal((calls[0] as { spec: VisualSpec }).spec.kind, 'model');
  assert.equal((calls[0] as { spec: { assetId: string } }).spec.assetId, 'model:juno');
  assert.equal(sdk.visual.status('object:test')?.phase, 'loading');
  sdk.visual.clear('object:test');
  assert.equal((calls[1] as { spec: null }).spec, null);
  assert.throws(() => sdk.visual.set('object:test', { kind: 'model', assetId: 'https://other/model', scene: 0, scaleKmPerUnit: 1 }), /asset/);
  assert.throws(() => sdk.visual.set('object:test', { kind: 'sphere', inventedShader: 'unsafe' } as unknown as VisualSpec), /fields/);
  await host.shutdown();
  assert.throws(() => sdk.visual.set('object:test', spec), /inactive/);
});

test('publishing data alone does not authorize visual changes', async () => {
  let sdk!: PluginContext;
  const host = new PluginHost();
  host.register({ id: 'example.data', apiVersion: 1, capabilities: ['data.publish'] }, context => { sdk = context; });
  await host.enable('example.data', ['data.publish']);
  assert.throws(() => sdk.visual.clear('object:test'), /permission/);
  await host.shutdown();
});
