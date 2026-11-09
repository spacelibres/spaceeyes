import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parkerWind} from '../platform/solar-wind.ts';
import config from '../validation/solar-wind-model.json' with {type:'json'};
export async function prepareSolarWind() {
 const model=parkerWind(config), base=model.at(config.solarRadiusM);
 let travel=0, previous=base;
 const profile=[];
 for(let i=0;i<=256;i++) {
  const r=i===256?config.auM:config.solarRadiusM*(config.auM/config.solarRadiusM)**(i/256);
  const state=model.at(r);
  if(i)travel+=(r-previous.radiusM)*0.5*(1/state.speedMS+1/previous.speedMS);
  profile.push({...state,flightTimeSeconds:travel});previous=state;
 }
 const local=[];travel=0;previous=base;
 for(let i=0;i<64;i++) {
  const state=model.at(config.solarRadiusM*(12**(i/63)));
  if(i)travel+=(state.radiusM-previous.radiusM)*0.5*(1/state.speedMS+1/previous.speedMS);
  local.push({r:state.radiusM/config.solarRadiusM,logDensity:Math.log(state.electronDensityM3/base.electronDensityM3),travel});previous=state;
 }
 const f=(v:number)=>Number(v).toExponential(9);
 const array=(name:string,values:number[])=>`const ${name}:array<f32,64>=array<f32,64>(${values.map(f).join(',')});\n`;
 const generated='// Generated Parker isothermal profile; SI seconds, density relative to base.\n'+array('WIND_R',local.map(s=>s.r))+array('WIND_LOG_N',local.map(s=>s.logDensity))+array('WIND_TRAVEL',local.map(s=>s.travel))+`
 fn solar_wind_state(radius:f32)->vec2<f32> {
  let r=clamp(radius,1.0,12.0);
  let i=min(u32(log(r)/log(12.0)*63.0),62u);
  let a=clamp((r-WIND_R[i])/(WIND_R[i+1]-WIND_R[i]),0.0,1.0);
  return vec2<f32>(exp(mix(WIND_LOG_N[i],WIND_LOG_N[i+1],a)),mix(WIND_TRAVEL[i],WIND_TRAVEL[i+1],a));
 }
 `;
 const root=new URL('../web/public/assets/',import.meta.url);
 await mkdir(new URL('solar-wind/',root),{recursive:true});
 const report={config,soundSpeedMS:model.soundSpeedMS,sonicRadiusM:model.sonicRadiusM,atBase:base,atOneAu:model.at(config.auM),profile};
 await writeFile(new URL('solar-wind/profile.json',root),JSON.stringify(report,null,2)+'\n');
 const source=await readFile(new URL('../web/resources/shaders/stellar.wgsl',import.meta.url),'utf8');
 await writeFile(new URL('shaders/stellar.wgsl',root),generated+source);
 await mkdir(new URL('../validation/results/',import.meta.url),{recursive:true});
 await writeFile(new URL('../validation/results/solar-wind-model.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
