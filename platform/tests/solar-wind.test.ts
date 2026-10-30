import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parkerWind} from '../solar-wind.ts';
import config from '../../validation/solar-wind-model.json' with {type:'json'};
test('Parker transonic branch satisfies equation and conserved mass flux',()=>{
 const m=parkerWind(config); assert.ok(m.sonicRadiusM>config.solarRadiusM&&m.sonicRadiusM<config.auM);
 assert.ok(Math.abs(m.at(m.sonicRadiusM).speedMS/m.soundSpeedMS-1)<1e-12);
 let last=0, flux=0;
 for(let i=0;i<=100;i++) {
  const r=config.solarRadiusM*(config.auM/config.solarRadiusM)**(i/100),s=m.at(i===100?config.auM:r);
  const w=(s.speedMS/m.soundSpeedMS)**2,x=s.radiusM/m.sonicRadiusM;
  assert.ok(Math.abs(w-Math.log(w)-(4*Math.log(x)+4/x-3))<1e-10);
  assert.ok(s.speedMS>last);last=s.speedMS;
  const f=s.radiusM**2*s.electronDensityM3*s.speedMS;
  if(i)assert.ok(Math.abs(f/flux-1)<1e-12);else flux=f;
 }
 assert.ok(Math.abs(m.at(config.auM).electronDensityM3/config.referenceElectronDensityM3-1)<1e-12);
});
test('Parker rejects invalid boundaries and queries',()=>{
 for(const v of [0,-1,NaN,Infinity,1e100,1e-100])assert.throws(()=>parkerWind({...config,temperatureK:v}));
 const m=parkerWind(config);for(const r of [0,NaN,Infinity,config.auM*2])assert.throws(()=>m.at(r));
});
