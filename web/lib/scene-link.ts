/** Semantic scene state; intentionally excludes internal camera angles and assets. */
export interface SceneLinkState {
  targetId: string;
  epoch?: number;
  rate: number;
  playing: boolean;
  mode: "nearby" | "system" | "follow";
  followId?: string;
  view: "orbit" | "top" | "front" | "side";
  lighting: "natural" | "shadow" | "flood";
  fovDegrees: number;
  labels: boolean;
  trajectories: boolean;
  trails: boolean;
  moons: boolean;
  spacecraft: boolean;
}
const keys = new Set([
  "tdb",
  "rate",
  "play",
  "mode",
  "follow",
  "view",
  "light",
  "fov",
  "labels",
  "orbits",
  "trails",
  "moons",
  "craft",
]);
function invalid(): never {
  throw Error("Invalid scene link");
}
export function parseSceneLink(
  hash: string,
  knownIds: readonly string[],
): SceneLinkState | undefined {
  if (hash === "") return undefined;
  if (
    typeof hash !== "string" ||
    hash.length > 4096 ||
    !hash.startsWith("#/") ||
    /%(?![0-9a-f]{2})/i.test(hash)
  )
    invalid();
  const split = hash.indexOf("?");
  const path = hash.slice(2, split < 0 ? undefined : split);
  let id: string;
  try {
    id = decodeURIComponent(path);
  } catch {
    invalid();
  }
  const targetId = id === "home" ? "" : id;
  if (!id || (targetId && !knownIds.includes(targetId))) invalid();
  const q = new URLSearchParams(split < 0 ? "" : hash.slice(split + 1));
  const seen = new Set<string>();
  for (const [key] of q) {
    if (!keys.has(key) || seen.has(key)) invalid();
    seen.add(key);
  }
  const number = (key: string, fallback: number, limit: number) => {
    const raw = q.get(key);
    if (raw === null) return fallback;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) invalid();
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > limit) invalid();
    return value;
  };
  const choice = <T extends string>(
    key: string,
    values: readonly T[],
    fallback: T,
  ): T => {
    const value = q.get(key) ?? fallback;
    if (!values.includes(value as T)) invalid();
    return value as T;
  };
  const flag = (key: string) => choice(key, ["0", "1"], "1") === "1";
  const rate = number("rate", 1, 94608000);
  if (rate === 0) invalid();
  const fovDegrees = number("fov", 45, 100);
  if (fovDegrees < 10) invalid();
  const mode = choice(
    "mode",
    ["nearby", "system", "follow"] as const,
    "nearby",
  );
  const followId = q.get("follow") ?? undefined;
  if (mode === "follow") {
    if (
      !targetId ||
      !followId ||
      followId === targetId ||
      !knownIds.includes(followId)
    )
      invalid();
  } else if (followId !== undefined) invalid();
  if (!targetId && mode !== "nearby") invalid();
  return {
    targetId,
    ...(q.has("tdb") ? { epoch: number("tdb", 0, 1e12) } : {}),
    rate,
    playing: flag("play"),
    mode,
    ...(followId ? { followId } : {}),
    view: choice("view", ["orbit", "top", "front", "side"] as const, "orbit"),
    lighting: choice(
      "light",
      ["natural", "shadow", "flood"] as const,
      "natural",
    ),
    fovDegrees,
    labels: flag("labels"),
    trajectories: flag("orbits"),
    trails: flag("trails"),
    moons: flag("moons"),
    spacecraft: flag("craft"),
  };
}
export function formatSceneLink(
  state: SceneLinkState,
  knownIds: readonly string[],
): string {
  if (
    !state ||
    typeof state.targetId !== "string" ||
    ![
      state.playing,
      state.labels,
      state.trajectories,
      state.trails,
      state.moons,
      state.spacecraft,
    ].every((v) => typeof v === "boolean") ||
    typeof state.rate !== "number" ||
    typeof state.fovDegrees !== "number" ||
    (state.epoch !== undefined && typeof state.epoch !== "number")
  )
    invalid();
  const q = new URLSearchParams();
  if (state.epoch !== undefined) q.set("tdb", String(state.epoch));
  q.set("rate", String(state.rate));
  q.set("play", state.playing ? "1" : "0");
  q.set("mode", state.mode);
  if (state.followId !== undefined) q.set("follow", state.followId);
  q.set("view", state.view);
  q.set("light", state.lighting);
  q.set("fov", String(state.fovDegrees));
  for (const [key, value] of [
    ["labels", state.labels],
    ["orbits", state.trajectories],
    ["trails", state.trails],
    ["moons", state.moons],
    ["craft", state.spacecraft],
  ] as const)
    q.set(key, value ? "1" : "0");
  const hash = `#/${state.targetId ? encodeURIComponent(state.targetId) : "home"}?${q}`;
  parseSceneLink(hash, knownIds);
  return hash;
}
