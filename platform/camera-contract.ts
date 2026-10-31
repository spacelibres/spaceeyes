import { targetId as validateTargetId } from "./state-contract.ts";
export type CameraObservationMode = "nearby" | "system" | "follow";
export interface CameraObservationOptions {
  readonly members?: readonly string[];
  readonly followId?: string;
  readonly systemId?: string;
}
export interface CameraObservation extends CameraObservationOptions {
  readonly targetId: string;
  readonly mode: CameraObservationMode;
}
export function cameraInput(value: number, limit: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > limit
  )
    throw Error("invalid camera input");
  return value;
}
export function snapshotObservation(
  targetId: string,
  mode: CameraObservationMode,
  options?: CameraObservationOptions,
): Readonly<CameraObservation> {
  validateTargetId(targetId);
  if (!["nearby", "system", "follow"].includes(mode))
    throw Error("invalid camera observation mode");
  if (
    options !== undefined &&
    (!options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Reflect.ownKeys(options).some(
        (key) => key !== "members" && key !== "followId" && key !== "systemId",
      ))
  )
    throw Error("invalid camera observation options");
  const context = options && Object.hasOwn(options, "systemId")
    ? { systemId: validateTargetId(options.systemId) } : {};
  const members = options?.members,
    followId = options?.followId;
  if (mode === "nearby") {
    if (options && Reflect.ownKeys(options).some(key => key !== "systemId"))
      throw Error("invalid nearby observation");
    return Object.freeze({ targetId, mode, ...context });
  }
  if (mode === "system") {
    if (
      (options && Object.hasOwn(options, "followId")) ||
      !Array.isArray(members) ||
      members.length === 0 ||
      members.length > 128 ||
      new Set(members).size !== members.length ||
      !members.includes(targetId)
    )
      throw Error("invalid system observation");
    members.forEach(validateTargetId);
    return Object.freeze({
      targetId,
      mode,
      ...context,
      members: Object.freeze([...members]),
    });
  }
  if (
    (options && Object.hasOwn(options, "members")) ||
    followId === undefined ||
    followId === targetId
  )
    throw Error("invalid follow observation");
  validateTargetId(followId);
  return Object.freeze({ targetId, mode, followId, ...context });
}
