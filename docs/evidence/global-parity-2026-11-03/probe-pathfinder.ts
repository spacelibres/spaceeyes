import {staticPosition,staticCoverage,staticVelocity} from '../../../platform/eyes-controllers.ts';
import {parentAt} from '../../../platform/eyes-catalog.ts';
import {solarCatalog} from '../../../platform/solar-system.ts';
const boundary=-78692826,id='sc_mars_pathfinder';
console.log(JSON.stringify({id,displayCatalog:solarCatalog.some(x=>x.id===id),scope:'Real catalog declaration evaluator; not an end-to-end resource or GPU certificate'}));
for(const epoch of [boundary-.001,boundary,boundary+.001,boundary-.001,boundary]) {
 const position=staticPosition(id,epoch),velocity=staticVelocity(id,epoch),coverage=staticCoverage(id,epoch);
 console.log(JSON.stringify({epoch,parent:parentAt(id,epoch),position,velocity,coverage}));
 if(epoch>=boundary && (Math.hypot(...position!)>1e-12||Math.hypot(...velocity!)>1e-12))throw Error('Landed state mismatch');
}
