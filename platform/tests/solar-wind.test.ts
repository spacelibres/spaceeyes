import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parkerWind,windMaterialPoint} from '../solar-wind.ts';
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

test('3D material labels follow outward radial characteristics independently of the camera',()=>{
 for(const axis of [[1,0,0],[0,1,0],[0,0,-1],[Math.SQRT1_2,Math.SQRT1_2,0]]) {
  const p=axis.map(v=>v*2) as [number,number,number], moved=axis.map(v=>v*4) as [number,number,number];
  const a=windMaterialPoint(p,1000,200,10000),b=windMaterialPoint(moved,1400,600,10000);
  a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-12));
  assert.ok(moved.reduce((s,v,i)=>s+(v-p[i])*axis[i],0)>0);
  const camera=axis.map(v=>v*8);
  const before=Math.hypot(...camera.map((v,i)=>v-p[i])),after=Math.hypot(...camera.map((v,i)=>v-moved[i]));
  assert.ok(after<before, 'front hemisphere material approaches the camera in 3D');
  assert.ok(1/after>1/before, 'perspective scale grows with approach');
 }
 assert.throws(()=>windMaterialPoint([0,0,0],0,0,10));
 assert.throws(()=>windMaterialPoint([1,0,0],0,0,0));
});
