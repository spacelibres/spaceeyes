import {snapshotSettings,stellarDefaults} from '../../platform/stellar-tuning.ts';
// The workspace has one solar appearance; legacy SDK rendering stays independent.
export function solarWorkspaceSettings(input:unknown=stellarDefaults()):Record<string,number>{
 return {...snapshotSettings(input),observationStyle:1};
}
export function restoreSolarWorkspaceSettings(saved:string|null):Record<string,number>{
 if(!saved)return solarWorkspaceSettings();
 const parsed=JSON.parse(saved);
 if(![1,2].includes(parsed.version))throw Error('太阳配置版本不支持');
 return solarWorkspaceSettings(parsed.settings);
}
