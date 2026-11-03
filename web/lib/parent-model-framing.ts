import envelopes from "../../validation/eyes-parent-framing.json" with {type:"json"};
import type {EyesDefinition} from "../../platform/eyes-catalog.ts";

/** Server-audited geometry, not a physical radius or a moving world-space AABB. */
export function parentModelFraming(id:string,model:EyesDefinition["model"]):number|undefined {
 if(!Object.hasOwn(envelopes.entries,id))return;
 const row=(envelopes.entries as Record<string,{model:unknown;radiusKm:number}>)[id];
 if(JSON.stringify(row.model)!==JSON.stringify(model))return;
 return Number.isFinite(row.radiusKm)&&row.radiusKm>0&&row.radiusKm<=1e12?row.radiusKm:undefined;
}
