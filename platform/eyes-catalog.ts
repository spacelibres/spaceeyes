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
  Object.hasOwn(eyesDefinitions,id)?eyesDefinitions[id]:undefined;
export function parentAt(id: string, epoch: number): string | null {
  let parent: null | string = null;
  for (const [start, p] of eyesDefinitions[id]?.parents ?? [])
    if (epoch >= Number(start)) parent = p;
  return parent;
}
export function declaredTracks(
  id: string,
  type: "orb" | "ori" = "orb",
): string[] {
  return (eyesDefinitions[id]?.controllers ?? [])
    .filter(
      (c) =>
        c.type === "dynamo" &&
        typeof c.url === "string" &&
        (type === "ori"
          ? /\/(ori|quat|quat_v2)$/.test(c.url)
          : !/\/(ori|quat|quat_v2)$/.test(c.url)),
    )
    .map((c) => c.url);
}
export const eyesCatalog = catalog.targets.map((t) => {
  const d = getEyesDefinition(t.id);
  const physical =
    typeof d?.radius === "number"
      ? d.radius
      : typeof d?.spheroid?.equatorialRadius === "number"
        ? d.spheroid.equatorialRadius
        : undefined;
  return {
    id: t.id,
    name: t.displayName ?? t.iauName ?? d?.label ?? t.id,
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
    subcategory: t.subcategory,
    keywords: t.keywords ?? [],
    altName: t.altName,
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
