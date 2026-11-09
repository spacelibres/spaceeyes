import test from 'node:test';
import assert from 'node:assert/strict';
import {eyesModelPhase,eyesModelVariants} from '../eyes-model-phases.ts';
test('inclusive phases restore without history',()=>{
assert.match(eyesModelPhase('sc_jwst',694937889.184)!.model.url,/stowed/);
assert.match(eyesModelPhase('sc_jwst',694937890)!.model.url,/deployed/);
assert.match(eyesModelPhase('sc_insight',596533602)!.model.url,/lander/);
assert.equal(eyesModelPhase('sc_stardust',190576691)!.hiddenNodes.length,6);
assert.equal(eyesModelPhase('sc_stardust',0)!.hiddenNodes.length,0);
assert.deepEqual(eyesModelPhase('sc_mars_2020',666953087)!.model.rotationWxyz,[.5,-.5,.5,-.5]);
assert.deepEqual(eyesModelPhase('sc_mars_2020',666953087)!.model.translate,[0,0,.001]);
assert.equal(eyesModelPhase('sc_mars_2020',666953086.614)!.hiddenNodes.length,2);
assert.equal(eyesModelPhase('sc_mars_2020',0)!.hiddenNodes.length,0);
assert.equal(eyesModelPhase('sun',0),undefined); assert.deepEqual(eyesModelVariants('sun'),[]);
for(const p of eyesModelVariants('sc_mars_science_laboratory'))assert.ok(Object.isFrozen(p.model));
});
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import config from '../eyes-model-phases.json' with {type:'json'};
test('all 26 fixed slots pin authoritative hashes and Stardust array',()=>{
 const ledger=JSON.parse(readFileSync(new URL('../../docs/evidence/time-history-0.0.69/coverage-actions.json',import.meta.url),'utf8'));
 const slots=ledger.actions.filter((a:any)=>['model-url-transform-phase','model-part-visibility'].includes(a.category));
 assert.equal(config.actions.length,26);assert.equal(slots.length,26);
 for(const a of config.actions){const source=slots.find((x:any)=>x.entity===a.entity&&x.controllerIndex===a.controllerIndex&&x.phase===a.phase);assert.ok(source);assert.equal(a.sourceSha256,source.sourceSha256);assert.equal(createHash('sha256').update(source.matches[0].source).digest('hex'),a.sourceSha256);}
 const evidence=config.stardustEvidence;
 assert.equal(createHash('sha256').update(evidence.source).digest('hex'),evidence.sha256);
 const parts = JSON.parse(evidence.source.slice(evidence.source.indexOf('['), -1));
 for (const action of config.actions.filter(a => a.entity === 'sc_stardust')) assert.deepEqual(action.hidden.map(pair => pair[0]), parts);
});
test('lookup performs no per-call model cloning and rejects non-finite time', () => {
 const original = globalThis.structuredClone;
 globalThis.structuredClone = (() => { throw new Error('per-frame clone'); }) as typeof structuredClone;
 try { assert.strictEqual(eyesModelPhase('sc_jwst', 0), eyesModelPhase('sc_jwst', 1)); }
 finally { globalThis.structuredClone = original; }
 for (const t of [NaN, Infinity, -Infinity]) assert.equal(eyesModelPhase('sc_jwst', t), undefined);
});
import { getEyesDefinition } from '../eyes-catalog.ts';
test('every finite boundary resolves immutable stable variants, including base gaps', () => {
 const checkFrozen = (value: unknown) => {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) checkFrozen(child);
 };
 for (const id of new Set(config.actions.map(action => action.entity))) {
  const variants = eyesModelVariants(id);
  checkFrozen(variants);
  assert.strictEqual(variants, eyesModelVariants(id));
  for (const phase of variants) {
   assert.ok(phase.model.url);
   for (const number of [...(phase.model.translate ?? []), ...(phase.model.rotationWxyz ?? [])]) assert.ok(Number.isFinite(number));
  }
  const boundaries = config.actions.filter(action => action.entity === id).flatMap(action => action.coverage.map(Number)).filter(Number.isFinite);
  for (const boundary of boundaries) for (const epoch of [boundary - .00001, boundary, boundary + .00001, -Number.MAX_VALUE, Number.MAX_VALUE]) {
   const phase = eyesModelPhase(id, epoch);
   assert.ok(phase);
   assert.ok(variants.includes(phase));
   assert.strictEqual(phase, eyesModelPhase(id, epoch));
  }
 }
 assert.deepEqual(eyesModelPhase('sc_insight', 0)!.model, getEyesDefinition('sc_insight')!.model);
 assert.match(eyesModelPhase('sc_insight', 596533602 - .00001)!.model.url, /cruise/);
 assert.match(eyesModelPhase('sc_insight', 596533602)!.model.url, /lander/);
 assert.deepEqual(eyesModelPhase('sc_insight', 0)!.model, getEyesDefinition('sc_insight')!.model);
});
