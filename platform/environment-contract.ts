export type EnvironmentSpec = {
  readonly assetId: string;
  readonly frame: "ICRF";
  readonly intensity: number;
};
export function snapshotEnvironment(
  spec: EnvironmentSpec,
): Readonly<EnvironmentSpec> {
  if (
    !spec ||
    typeof spec !== "object" ||
    Reflect.ownKeys(spec).some(
      (key) =>
        typeof key !== "string" ||
        !["assetId", "frame", "intensity"].includes(key),
    ) ||
    typeof spec.assetId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/.test(spec.assetId) ||
    spec.frame !== "ICRF" ||
    !Number.isFinite(spec.intensity) ||
    spec.intensity < 0 ||
    spec.intensity > 4
  )
    throw Error("invalid environment");
  return Object.freeze({ ...spec });
}
