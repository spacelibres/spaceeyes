import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stellarDefaults} from '../../platform/stellar-tuning.ts';
import {solarWorkspaceSettings,restoreSolarWorkspaceSettings} from './solar-settings.ts';
test('startup, stored v1/v2 and panel use one appearance while retaining user values',()=>{
 const custom={...stellarDefaults(),observationStyle:0,surfaceGain:.7,paused:1,temperatureMK:2};
 for(const version of [1,2]){
  const settings=version===1?Object.fromEntries(Object.entries(custom).slice(0,58)):custom;
  const restored=restoreSolarWorkspaceSettings(JSON.stringify({version,settings}));
  assert.equal(restored.observationStyle,1);assert.equal(restored.surfaceGain,.7);assert.equal(restored.paused,1);assert.equal(restored.temperatureMK,2);
  assert.deepEqual(solarWorkspaceSettings(restored),restored);
 }
 assert.deepEqual(restoreSolarWorkspaceSettings(null),solarWorkspaceSettings());
 assert.throws(()=>restoreSolarWorkspaceSettings('{"version":3}'));
});
