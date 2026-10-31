import { snapshotJoints, type JointAim, type JointStatus } from "./joint-contract.ts";
import type { CameraObservation } from "./camera-contract.ts";
import type { StellarTuning } from "./stellar-tuning.ts";
import type { StarfieldSpec } from "./starfield-contract.ts";
import type { EnvironmentSpec } from "./environment-contract.ts";
// Internal host-to-core adapter boundary, not a public wire protocol.
// An implementation must forward to Rust/Bevy and validate target existence there.
import type { ObjectState } from "./state-contract.ts";
import type { VisualSpec, VisualStatus } from "./visual-contract.ts";
export interface FocusRequest {
  readonly pluginId: string;
  readonly sessionId: string;
  readonly targetId: string;
}
export interface CorePort {
  modelJoints?(request: FocusRequest & { aims: readonly JointAim[] }): void;
  jointStatus?(request: FocusRequest): JointStatus | null;
  cameraLighting?(request: {
    readonly sessionId: string;
    readonly pluginId: string;
    readonly mode: "natural" | "shadow" | "flood";
  }): void;
  cameraObserve?(request: FocusRequest & CameraObservation): void;
  cameraOrbit?(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly yawRadians: number;
    readonly pitchRadians: number;
  }): void;
  cameraZoom?(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly delta: number;
  }): void;
  cameraFov?(request: {
    pluginId: string;
    sessionId: string;
    degrees: number;
  }): void;
  environment?(request: {
    pluginId: string;
    sessionId: string;
    spec: Readonly<EnvironmentSpec> | null;
  }): void;
  openSession(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly cameraControl: boolean;
    readonly dataPublish: boolean;
    readonly timeControl: boolean;
    readonly visualControl: boolean;
  }): void;
  trajectory?(
    request: FocusRequest & {
      points: readonly (readonly number[])[];
      epochsTdbSeconds?: readonly number[];
      originId?: string;
      colorRgba?: readonly number[];
      kind?: "orbit" | "trail";
      trailDurationSeconds?: number;
      breakIndices?: readonly number[];
    },
  ): void;
  label?(request: FocusRequest & { text: string }): void;
  layers?(request: {
    pluginId: string;
    sessionId: string;
    labels: boolean;
    trajectories: boolean;
  }): void;
  cameraView?(request: {
    pluginId: string;
    sessionId: string;
    mode: "overview" | "top" | "front" | "side" | "orbit";
  }): void;
  focus(request: FocusRequest): void;
  publishObject?(
    request: FocusRequest & { readonly state: Readonly<ObjectState> },
  ): void;
  removeObject?(request: FocusRequest): void;
  tuneStellar?(
    request: FocusRequest & { readonly tuning: StellarTuning },
  ): void;
  setVisual?(
    request: FocusRequest & { readonly spec: Readonly<VisualSpec> | null },
  ): void;
  visualStatus?(request: FocusRequest): VisualStatus | null;
  seek?(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly epochTdbSeconds: number;
  }): void;
  setPlayback?(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly playing: boolean;
    readonly rate: number;
  }): void;
  starfield?(request: {
    readonly pluginId: string;
    readonly sessionId: string;
    readonly layerId: string;
    readonly spec: Readonly<StarfieldSpec> | null;
  }): void;
  releaseSession(sessionId: string): void | Promise<void>;
}
