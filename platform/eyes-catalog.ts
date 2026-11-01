import catalog from "./eyes-catalog.json" with { type: "json" };
export type EyesDefinition = {
  [key: string]: any;
  parents?: [number | string, string][];
  model?: {
    url: string;
    scale?: number | number[];
    rotate?: Record<string, number>[];
    translate?: number[];
  };
  controllers?: any[];
};
export const eyesDefinitions: Record<string, EyesDefinition> =
  catalog.definitions as unknown as Record<string, EyesDefinition>;
export const getEyesDefinition = (id: string): EyesDefinition | undefined =>
  Object.hasOwn(eyesDefinitions, id) ? eyesDefinitions[id] : undefined;
export function parentAt(id: string, epoch: number): string | null {
  let parent: null | string = null;
  for (const [start, p] of eyesDefinitions[id]?.parents ?? [])
    if (epoch >= Number(start)) parent = p;
  return parent;
}
export function declaredTracks(
  id: string,
  type: "orb" | "ori" = "orb",
  epoch?: number,
): string[] {
  return (eyesDefinitions[id]?.controllers ?? [])
    .filter(
      (c) =>
        c.type === "dynamo" &&
        typeof c.url === "string" &&
        (epoch === undefined || (Number.isFinite(epoch) && (!c.coverage ||
          (epoch >= Number(c.coverage[0]) && epoch <= Number(c.coverage[1]))))) &&
        (type === "ori"
          ? /\/(ori|quat|quat_v2)$/.test(c.url)
          : !/\/(ori|quat|quat_v2)$/.test(c.url)),
    )
    .map((c) => c.url);
}
/** Cache identity includes all covered position tracks in source declaration order. */
export function positionTrackKey(id:string,epoch:number):string {
  return JSON.stringify(declaredTracks(id,"orb",epoch));
}
export function positionTrackBoundaries(id:string):number[] {
  return (eyesDefinitions[id]?.controllers??[])
    .filter(c=>c.type==="dynamo"&&typeof c.url==="string"&&!/\/(ori|quat|quat_v2)$/.test(c.url))
    .flatMap(c=>(c.coverage??[]).map(Number)).filter(Number.isFinite);
}
export function positionFrameKey(id:string,epoch:number,referenceId?:string):string {
  const seen=new Set<string>(),parts:unknown[]=[];
  const pending=[id,...(referenceId?[referenceId]:[])];
  while(pending.length) {
    const target=pending.pop()!;
    if(seen.has(target)||target==="sun")continue;
    seen.add(target);
    const parent=parentAt(target,epoch);
    parts.push([target,parent,positionTrackKey(target,epoch)]);
    if(parent)pending.push(parent);
  }
  return JSON.stringify(parts);
}
/** Source-defined missions omitted by the captured discovery target list.
 * Keep the raw NASA catalog capture unchanged and expand only reviewed definitions. */
export const additionalEyesTargets = ["sc_noaa_20", "sc_noaa_21"].map((id) => ({
  id,
  category: "Spacecraft",
  displayName: getEyesDefinition(id)?.label ?? id,
}));
const expandedDiscovery = new Set(additionalEyesTargets.map((t) => t.id));
export const eyesCatalog = [
  ...catalog.targets,
  ...additionalEyesTargets.filter(
    (t) => !catalog.targets.some((original) => original.id === t.id),
  ),
].map((t) => {
  const d = getEyesDefinition(t.id);
  const physical =
    typeof d?.radius === "number"
      ? d.radius
      : typeof d?.spheroid?.equatorialRadius === "number"
        ? d.spheroid.equatorialRadius
        : undefined;
  return {
    id: t.id,
    name:
      t.displayName ??
      ("iauName" in t ? t.iauName : undefined) ??
      d?.label ??
      t.id,
    parentId: d?.parents?.[0]?.[1] ?? null,
    radiusKm: physical ?? d?.extentsRadius ?? 0,
    kind: t.category === "Moon" ? ("moon" as const) : ("spacecraft" as const),
    color: [0.65, 0.7, 0.8, 1] as [number, number, number, number],
    orbPath: declaredTracks(t.id)[0] ?? null,
    source: "Eyes static entity definitions",
    radiusSource:
      physical !== undefined
        ? "Eyes physical radius"
        : d?.extentsRadius !== undefined
          ? "Eyes model framing extents; not physical radius"
          : "unavailable",
    model: d?.model,
    surface: d?.spheroidLOD,
    discoverySource: expandedDiscovery.has(t.id)
      ? "App-expanded discovery from reviewed Eyes entity definitions"
      : "Captured Eyes target list",
    subcategory: "subcategory" in t ? t.subcategory : undefined,
    keywords: "keywords" in t ? (t.keywords ?? []) : [],
    altName: "altName" in t ? t.altName : undefined,
    unsupported: !d,
  };
});
export const eyesDependencies = (() => {
  const targets = new Set(eyesCatalog.map((x) => x.id));
  const needed = new Set<string>();
  function visit(id: string) {
    if (needed.has(id) || !id) return;
    needed.add(id);
    for (const [, parent] of eyesDefinitions[id]?.parents ?? []) visit(parent);
  }
  for (const target of eyesCatalog) visit(target.id);
  return [...needed]
    .filter((id) => !targets.has(id) && eyesDefinitions[id])
    .map((id) => {
      const d = eyesDefinitions[id];
      return {
        id,
        name: d.label ?? id,
        parentId: d.parents?.[0]?.[1] ?? null,
        radiusKm:
          typeof d.radius === "number" ? d.radius : (d.extentsRadius ?? 0),
        kind: "planet" as const,
        color: [0.65, 0.7, 0.8, 1] as [number, number, number, number],
        orbPath: declaredTracks(id)[0] ?? null,
        source: "Eyes dependency entity definitions",
        radiusSource:
          typeof d.radius === "number"
            ? "Eyes physical radius"
            : "Eyes framing extents or unavailable",
        model: d.model,
        surface: d.spheroidLOD,
      };
    });
})();
