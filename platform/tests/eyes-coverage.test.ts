import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageLifecycle, eyesCoverageLabel, EYES_COVERAGE_LABEL_MANIFEST } from '../eyes-coverage.ts';
test('label phases are inclusive and independent of history', () => {
 assert.equal(eyesCoverageLabel('sc_themis_b',264427265,'ARTEMIS P1'),'THEMIS B');
 assert.equal(eyesCoverageLabel('sc_themis_b',264427266,'THEMIS B'),'ARTEMIS P1');
 assert.equal(eyesCoverageLabel('sc_osiris_rex',748838793,'OSIRIS-REx'),'OSIRIS-APEX');
 assert.equal(EYES_COVERAGE_LABEL_MANIFEST.length,6);
});
test('all exits precede enters; throttle survives exit, reverse and jumps; reset and dispose clear state',()=>{
 const action=(text:string)=>({kind:'label-text' as const,text});
 const c=new CoverageLifecycle([
 {coverage:[10,20],enter:[action('a')],exit:[action('out-a')],update:[action('tick')],updateIntervalMs:100},
 {coverage:[0,9],enter:[action('b')],exit:[action('out-b')]},
 ]);
 assert.deepEqual(c.update(5,0).map(a=>a.text),['b']);
 assert.deepEqual(c.update(10,0).map(a=>a.text),['out-b','a','tick']);
 assert.deepEqual(c.update(21,10).map(a=>a.text),['out-a']);
 assert.deepEqual(c.update(20,50).map(a=>a.text),['a']);
 assert.deepEqual(c.update(20,100).map(a=>a.text),['tick']);
 c.reset(); assert.deepEqual(c.update(20,101).map(a=>a.text),['a','tick']);
 c.dispose(); assert.throws(()=>c.update(20,102));
});
test('manifest pins all six evidence hashes and literal replacements', async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const evidence=JSON.parse(await readFile(new URL('../../docs/evidence/time-history-0.0.69/coverage-actions.json',import.meta.url),'utf8'));
 const slots=evidence.actions.filter((a:{category:string})=>a.category==='label-text');
 assert.equal(slots.length,6);
 for(const slot of EYES_COVERAGE_LABEL_MANIFEST){
  const source=slots.find((s:{entity:string;phase:string})=>s.entity===slot.entity&&s.phase===slot.phase);
  assert.equal(source.sourceSha256,slot.sourceSha256);
  assert.equal(createHash('sha256').update(source.matches[0].source).digest('hex'),slot.sourceSha256);
  assert.deepEqual(source.coverage,slot.coverage);
  assert.ok(source.matches[0].source.includes(`replace("${slot.from}", "${slot.text}")`));
 }
});
test('input and output snapshots cannot change subsequent actions',()=>{
 const action={kind:'label-text' as const,text:'original'};
 const definition={coverage:[0,10] as [number,number],update:[action]};
 const lifecycle=new CoverageLifecycle([definition]);
 action.text='input mutation'; definition.coverage[1]=0; definition.update.length=0;
 const first=lifecycle.update(5,0);
 assert.equal(first[0].text,'original');
 assert.throws(()=>{(first[0] as {text:string}).text='output mutation';},TypeError);
 assert.equal(lifecycle.update(5,1)[0].text,'original');
});
test('invalid intervals and clocks fail; reset clears activity; disposal is terminal',()=>{
 for(const coverage of [[NaN,1],[2,1]] as [number,number][]) assert.throws(()=>new CoverageLifecycle([{coverage}]),RangeError);
 for(const updateIntervalMs of [-1,Infinity,NaN]) assert.throws(()=>new CoverageLifecycle([{coverage:[0,1],updateIntervalMs}]),RangeError);
 const c=new CoverageLifecycle([{coverage:[-Infinity,Infinity],enter:[{kind:'label-text',text:'enter'}]}]);
 for(const bad of [NaN,Infinity,-Infinity]) {assert.throws(()=>c.update(bad,0),RangeError);assert.throws(()=>c.update(0,bad),RangeError);}
 assert.equal(c.update(0,0).length,1);assert.equal(c.update(0,1).length,0);
 c.reset();assert.equal(c.update(0,2).length,1);
 c.dispose();c.dispose();assert.throws(()=>c.reset(),/Disposed/);assert.throws(()=>c.update(0,3),/Disposed/);
});
