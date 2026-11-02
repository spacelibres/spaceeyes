export interface ParkerConfig {
 solarGmM3S2:number; solarRadiusM:number; boltzmannJK:number; protonMassKg:number;
 auM:number; temperatureK:number; referenceElectronDensityM3:number;
}
export function parkerWind(config:ParkerConfig) {
 for(const value of Object.values(config)) if(typeof value==='number' && (!Number.isFinite(value)||value<=0)) throw Error('Invalid Parker parameter');
 const {solarGmM3S2:gm,solarRadiusM:radius,boltzmannJK:k,protonMassKg:mp,temperatureK:t,auM:reference,referenceElectronDensityM3:n}=config;
 if(![gm,radius,k,mp,t,reference,n].every(v=>Number.isFinite(v)&&v>0)||reference<=radius) throw Error('Invalid Parker boundary');
 const soundSpeedMS=Math.sqrt(2*k*t/mp), sonicRadiusM=gm/(2*soundSpeedMS**2);
 if(!Number.isFinite(soundSpeedMS)||!Number.isFinite(sonicRadiusM)||sonicRadiusM<=radius||sonicRadiusM>=reference) throw Error('Sonic point outside supported model domain');
 function speedMS(r:number) {
  if(!Number.isFinite(r)||r<radius||r>reference) throw Error('Radius outside model coverage');
  const x=r/sonicRadiusM;
  if(Math.abs(x-1)<1e-8) return soundSpeedMS;
  const a=4*Math.log(x)+4/x-3;
  let lo=x<1 ? -a-1 : 0, hi=x<1 ? 0 : Math.log(a+1)+2;
  for(let i=0;i<100;i++) {
   const y=(lo+hi)/2, f=Math.exp(y)-y-a;
   if((x<1 && f>0)||(x>1 && f<0))lo=y;else hi=y;
  }
  return soundSpeedMS*Math.exp((lo+hi)/4);
 }
 const referenceSpeed=speedMS(reference);
 function at(r:number) {
  const speed=speedMS(r), electronDensityM3=n*(reference/r)**2*referenceSpeed/speed;
  return {radiusM:r,speedMS:speed,electronDensityM3,massDensityKgM3:electronDensityM3*mp,temperatureK:t};
 }
 return {soundSpeedMS,sonicRadiusM,at};
}

/** Camera-independent 3D Lagrangian label used by the external volume shader. */
export function windMaterialPoint(positionR:readonly [number,number,number],flightSeconds:number,timeSeconds:number,periodSeconds:number):[number,number,number] {
 if(![...positionR,flightSeconds,timeSeconds,periodSeconds].every(Number.isFinite)||periodSeconds<=0) throw Error('Invalid wind transport');
 const radius=Math.hypot(...positionR); if(radius<1||radius>12.000001)throw Error('Outside visual volume');
 const q=(flightSeconds-timeSeconds)/periodSeconds, phase=q-Math.floor(q);
 return positionR.map(v=>v/radius*(1+11*phase)) as [number,number,number];
}
