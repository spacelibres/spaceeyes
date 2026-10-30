import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stellarDefaults,snapshotSettings,buildStellarTuning,snapshotStellarTuning,describeStellarWind,applySolarReferencePalette} from '../stellar-tuning.ts';
import {PluginHost,type PluginContext} from '../plugin-host.ts';
test('stellar settings validate strict fields, pairs, geometry and finite values',()=>{
 const defaults=stellarDefaults(); assert.ok(Object.keys(defaults).length>50);
 for(const changes of [{sampleCount:25},{flowSpeed:NaN},{outerRadius:8},{archCount:32,strandCount:5},{enterDistance:10,exitDistance:8},{unknown:1}]) assert.throws(()=>snapshotSettings({...defaults,...changes}));
 assert.ok(Object.isFrozen(snapshotSettings(defaults)));
});
test('Parker controls rebuild physical profile and immutable transport boundary',()=>{
 const a=buildStellarTuning(stellarDefaults());const input={...stellarDefaults(),temperatureMK:2,densityCm3:10};
 const b=buildStellarTuning(input); assert.equal(b.profile.density.length,64);assert.equal(b.profile.travel[0],0);assert.notDeepEqual(a.profile.travel,b.profile.travel);
 const diagnostics=describeStellarWind(input);assert.equal(diagnostics.oneAuDensityCm3,10); assert.ok(diagnostics.oneAuSpeedMS>0);
 const frozen=snapshotStellarTuning(b);input.temperatureMK=1;assert.equal(frozen.settings.temperatureMK,2);assert.ok(Object.isFrozen(frozen.profile.travel));
 assert.throws(()=>snapshotStellarTuning({...b,profile:{...b.profile,travel:[...b.profile.travel].reverse()}}));
 assert.throws(()=>snapshotStellarTuning({...b,profile:{...b.profile,density:Array(64).fill(-1)}}));
});
test('stellar tuning SDK requires capability, freezes data and revokes old generation',async()=>{
 let sdk!:PluginContext;const calls:any[]=[];
 const host=new PluginHost({openSession(){},focus(){},releaseSession(){},tuneStellar:r=>calls.push(r)});
 host.register({id:'test.solar',apiVersion:1,capabilities:['scene.visual']},ctx=>{sdk=ctx});await host.enable('test.solar',['scene.visual']);
 sdk.visual.stellar('sun',buildStellarTuning(stellarDefaults()));assert.equal(calls.length,1);assert.ok(Object.isFrozen(calls[0].tuning.settings));await host.shutdown();assert.throws(()=>sdk.visual.stellar('sun',buildStellarTuning(stellarDefaults())),/inactive/);
});

test('reference palette preserves user switches, dynamics and physical inputs',()=>{
 const custom:Record<string,number>={...stellarDefaults(),surfaceEnabled:0,volumeEnabled:0,archesEnabled:0,flowSpeed:.7,temperatureMK:2,densityCm3:10,archCount:12,surfaceColor:0,hotColor:0};
 const result=applySolarReferencePalette(custom);
 assert.equal(result.surfaceColor,0xff4400);assert.equal(result.hotColor,0xff7a0a);
 for(const key of ['surfaceEnabled','volumeEnabled','archesEnabled','flowSpeed','temperatureMK','densityCm3','archCount'])assert.equal(result[key],custom[key]);
 assert.equal(custom.surfaceColor,0);assert.ok(Object.isFrozen(result));
});
