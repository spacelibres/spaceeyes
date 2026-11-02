/** Effective cache domain after higher-priority source coverage was inspected.
 * The selected DYN payload keeps its original inclusive sample coverage.
 */
export type PositionSelection = Readonly<{
  track: string;
  lowerExclusive?: number;
  lowerInclusive?: number;
  upperExclusive?: number;
}>;
export function acceptsPositionEpoch(selection:PositionSelection|undefined,epoch:number):boolean {
  return Number.isFinite(epoch) && (!selection || ((selection.lowerExclusive===undefined||epoch>selection.lowerExclusive)&&
    (selection.lowerInclusive===undefined||epoch>=selection.lowerInclusive)&&
    (selection.upperExclusive===undefined||epoch<selection.upperExclusive)));
}
export function parsePositionSelection(raw:string|null):PositionSelection|undefined {
  if(raw===null)return undefined;
  const value=JSON.parse(raw);
  if(!value||typeof value.track!=="string"||!value.track||value.track.length>1024||
    ["lowerExclusive","lowerInclusive","upperExclusive"].some(key=>value[key]!==undefined&&!Number.isFinite(value[key]))||
    (value.upperExclusive!==undefined&&Math.max(value.lowerExclusive??-Infinity,value.lowerInclusive??-Infinity)>=value.upperExclusive))
    throw Error("Invalid position controller selection");
  return Object.freeze({track:value.track,
    ...(value.lowerExclusive===undefined?{}:{lowerExclusive:value.lowerExclusive}),
    ...(value.lowerInclusive===undefined?{}:{lowerInclusive:value.lowerInclusive}),
    ...(value.upperExclusive===undefined?{}:{upperExclusive:value.upperExclusive})});
}
