// Internal structured samples. This is not the final public transport protocol.
export interface ObjectState {
  orientationWxyz?: [number, number, number, number];
  positionKm: [number, number, number];
  radiusKm: number;
  epochTdbSeconds: number;
  coverageTdbSeconds: [number, number];
  frame: "ICRF";
  source: string;
}

export function targetId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/.test(value)
  )
    throw new Error("invalid target id");
  return value;
}

export function snapshotState(state: ObjectState): Readonly<ObjectState> {
  if (
    !state ||
    !Array.isArray(state.positionKm) ||
    state.positionKm.length !== 3 ||
    ![...state.positionKm].every(Number.isFinite) ||
    !Number.isFinite(state.radiusKm) ||
    state.radiusKm <= 0 ||
    !Number.isFinite(state.epochTdbSeconds) ||
    !Array.isArray(state.coverageTdbSeconds) ||
    state.coverageTdbSeconds.length !== 2 ||
    ![...state.coverageTdbSeconds].every(Number.isFinite) ||
    state.coverageTdbSeconds[0] > state.epochTdbSeconds ||
    state.coverageTdbSeconds[1] < state.epochTdbSeconds ||
    state.frame !== "ICRF" ||
    typeof state.source !== "string" ||
    !state.source.trim() ||
    new TextEncoder().encode(state.source).length > 2048
  )
    throw new Error("invalid object state");
  if (
    state.orientationWxyz !== undefined &&
    (!Array.isArray(state.orientationWxyz) ||
      state.orientationWxyz.length !== 4 ||
      !state.orientationWxyz.every(Number.isFinite) ||
      Math.abs(state.orientationWxyz.reduce((s, n) => s + n * n, 0) - 1) > 1e-6)
  )
    throw new Error("invalid orientation");
  const result: ObjectState = {
    positionKm: [...state.positionKm],
    radiusKm: state.radiusKm,
    epochTdbSeconds: state.epochTdbSeconds,
    coverageTdbSeconds: [...state.coverageTdbSeconds],
    frame: state.frame,
    source: state.source,
  };
  if (state.orientationWxyz)
    result.orientationWxyz = Object.freeze([
      ...state.orientationWxyz,
    ]) as unknown as [number, number, number, number];
  Object.freeze(result.positionKm);
  Object.freeze(result.coverageTdbSeconds);
  return Object.freeze(result);
}
