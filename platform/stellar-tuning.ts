import controls from './stellar-controls.json' with {type:'json'};
import baseConfig from '../validation/solar-wind-model.json' with {type:'json'};
import {parkerWind} from './solar-wind.ts';
export interface StellarTuning {
 readonly settings:Readonly<Record<string,number>>;
 readonly profile:{readonly density:readonly number[];readonly travel:readonly number[]};
}
export function stellarDefaults():Record<string,number> {return Object.fromEntries(controls.map(c=>[c.key,c.value]));}
export function snapshotSettings(input:unknown):Readonly<Record<string,number>> {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid stellar settings');
 const raw=input as Record<string,unknown>;
 if(Reflect.ownKeys(raw).length!==controls.length||Reflect.ownKeys(raw).some(k=>typeof k!=='string'||!controls.some(c=>c.key===k)))throw Error('Invalid stellar fields');
 const result:Record<string,number>={};
 for(const c of controls){const n=raw[c.key];if(typeof n!=='number'||!Number.isFinite(n)||n<c.min||n>c.max||(c.step===1&&!Number.isInteger(n)))throw Error(`Invalid stellar parameter: ${c.label}`);result[c.key]=n;}
 for(const [low,high] of [['channelLow','channelHigh'],['parcelLow','parcelHigh'],['streamLow','streamHigh'],['archLow','archHigh'],['enterDistance','exitDistance'],['fadeStart','outerRadius']])if(result[low]>=result[high])throw Error(`Invalid stellar pair: ${low} < ${high}`);
 if(result.fullDistance>result.enterDistance)throw Error('完全显示距离不能超过靠近触发距离');
 if(result.archCount*result.strandCount*49*7>50000)throw Error('日珥顶点预算不能超过50000');
 return Object.freeze(result);
}
function wind(settings:Readonly<Record<string,number>>) {
 return parkerWind({...baseConfig,temperatureK:settings.temperatureMK*1e6,referenceElectronDensityM3:settings.densityCm3*1e6});
}
export function describeStellarWind(input:unknown){
 const settings=snapshotSettings(input), model=wind(settings),one=model.at(baseConfig.auM);
 return {soundSpeedMS:model.soundSpeedMS,sonicRadiusR:model.sonicRadiusM/baseConfig.solarRadiusM,oneAuSpeedMS:one.speedMS,oneAuDensityCm3:one.electronDensityM3/1e6};
}
export function snapshotStellarTuning(input:unknown):StellarTuning {
 if(!input||typeof input!=='object'||Array.isArray(input)||Reflect.ownKeys(input).some(k=>k!=='settings'&&k!=='profile'))throw Error('Invalid stellar tuning');
 const raw=input as StellarTuning, settings=snapshotSettings(raw.settings),profile=raw.profile;
 if(!profile||Reflect.ownKeys(profile).some(k=>k!=='density'&&k!=='travel')||!Array.isArray(profile.density)||!Array.isArray(profile.travel)||profile.density.length!==64||profile.travel.length!==64)throw Error('Invalid stellar profile');
 if(profile.density.some(n=>!Number.isFinite(n)||n<=0||n>1.00001)||Math.abs(profile.density[0]-1)>1e-5||profile.travel[0]!==0||profile.travel.some((n,i)=>!Number.isFinite(n)||n<0||n>1e12||(i>0&&n<=profile.travel[i-1])))throw Error('Invalid stellar transport');
 return Object.freeze({settings,profile:Object.freeze({density:Object.freeze([...profile.density]),travel:Object.freeze([...profile.travel])})});
}
// Cache only physical inputs; visual slider changes never rerun the 64-point solver.
let cachedWind:{key:string;profile:StellarTuning['profile']}|undefined;
export function buildStellarTuning(input:unknown):StellarTuning {
 const settings=snapshotSettings(input),key=`${settings.temperatureMK}:${settings.densityCm3}`;
 if(cachedWind?.key!==key){
  const model=wind(settings),base=model.at(baseConfig.solarRadiusM);let previous=base, travel=0;
  const density:number[]=[],times:number[]=[];
  for(let i=0;i<64;i++){const state=model.at(baseConfig.solarRadiusM*12**(i/63));if(i)travel+=(state.radiusM-previous.radiusM)*.5*(1/state.speedMS+1/previous.speedMS);density.push(state.electronDensityM3/base.electronDensityM3);times.push(travel);previous=state;}
  cachedWind={key,profile:{density,travel:times}};
 }
 return snapshotStellarTuning({settings,profile:cachedWind.profile});
}

/** Reference-photo palette only: keep the user's geometry, physics and switches. */
export function applySolarReferencePalette(input:unknown):Readonly<Record<string,number>> {
 const settings=snapshotSettings(input), defaults=stellarDefaults();
 const keys=['surfaceGain','surfaceColor','coolColor','hotColor','archCoolColor','archHotColor'];
 return snapshotSettings({...settings,...Object.fromEntries(keys.map(key=>[key,defaults[key]]))});
}
