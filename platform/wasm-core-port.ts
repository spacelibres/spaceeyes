import type { CorePort, FocusRequest } from "./core-port.ts";
import type { ObjectState } from "./state-contract.ts";
import type { VisualSpec, VisualStatus } from "./visual-contract.ts";

/** Structural surface of wasm-bindgen's generated WasmCore; owned by the host. */
export interface WasmCoreBinding {
  tdb_to_utc?(tdbSeconds: number): number;
  utc_to_tdb?(unixSeconds: number): number;
  open_session(
    session: string,
    plugin: string,
    camera: boolean,
    data: boolean,
    time: boolean,
    visual: boolean,
  ): void;
  release_session(session: string): void;
  publish_object(
    session: string,
    plugin: string,
    target: string,
    sampleJson: string,
  ): void;
  remove_object(session: string, plugin: string, target: string): void;
  trajectory?(
    session: string,
    plugin: string,
    target: string,
    pointsJson: string,
  ): void;
  label?(session: string, plugin: string, target: string, text: string): void;
  layers?(
    session: string,
    plugin: string,
    labels: boolean,
    trajectories: boolean,
  ): void;
  camera_view?(session: string, plugin: string, mode: string): void;
  focus(session: string, plugin: string, target: string): void;
  seek(session: string, plugin: string, epoch: number): void;
  set_playback(
    session: string,
    plugin: string,
    playing: boolean,
    rate: number,
  ): void;
  set_visual(
    session: string,
    plugin: string,
    target: string,
    specJson: string,
  ): void;
  owned_visual_status(session: string, plugin: string, target: string): string;
}

export class WasmCorePort implements CorePort {
  #binding: WasmCoreBinding;
  constructor(binding: WasmCoreBinding) {
    this.#binding = binding;
  }
  openSession(request: Parameters<CorePort["openSession"]>[0]): void {
    this.#binding.open_session(
      request.sessionId,
      request.pluginId,
      request.cameraControl,
      request.dataPublish,
      request.timeControl,
      request.visualControl,
    );
  }
  releaseSession(sessionId: string): void {
    this.#binding.release_session(sessionId);
  }
  setVisual(
    request: FocusRequest & { readonly spec: Readonly<VisualSpec> | null },
  ): void {
    this.#binding.set_visual(
      request.sessionId,
      request.pluginId,
      request.targetId,
      JSON.stringify(request.spec),
    );
  }
  visualStatus(request: FocusRequest): VisualStatus | null {
    return JSON.parse(
      this.#binding.owned_visual_status(
        request.sessionId,
        request.pluginId,
        request.targetId,
      ),
    );
  }
  trajectory(
    request: Parameters<NonNullable<CorePort["trajectory"]>>[0],
  ): void {
    if (!this.#binding.trajectory) throw new Error("trajectory unavailable");
    this.#binding.trajectory(
      request.sessionId,
      request.pluginId,
      request.targetId,
      JSON.stringify(request.points),
    );
  }
  label(request: Parameters<NonNullable<CorePort["label"]>>[0]): void {
    if (!this.#binding.label) throw new Error("label unavailable");
    this.#binding.label(
      request.sessionId,
      request.pluginId,
      request.targetId,
      request.text,
    );
  }
  layers(request: Parameters<NonNullable<CorePort["layers"]>>[0]): void {
    if (!this.#binding.layers) throw new Error("layers unavailable");
    this.#binding.layers(
      request.sessionId,
      request.pluginId,
      request.labels,
      request.trajectories,
    );
  }
  cameraView(
    request: Parameters<NonNullable<CorePort["cameraView"]>>[0],
  ): void {
    if (!this.#binding.camera_view) throw new Error("camera view unavailable");
    this.#binding.camera_view(
      request.sessionId,
      request.pluginId,
      request.mode,
    );
  }
  focus(request: FocusRequest): void {
    this.#binding.focus(request.sessionId, request.pluginId, request.targetId);
  }
  publishObject(
    request: FocusRequest & { readonly state: Readonly<ObjectState> },
  ): void {
    this.#binding.publish_object(
      request.sessionId,
      request.pluginId,
      request.targetId,
      JSON.stringify(request.state),
    );
  }
  removeObject(request: FocusRequest): void {
    this.#binding.remove_object(
      request.sessionId,
      request.pluginId,
      request.targetId,
    );
  }
  seek(request: Parameters<NonNullable<CorePort["seek"]>>[0]): void {
    this.#binding.seek(
      request.sessionId,
      request.pluginId,
      request.epochTdbSeconds,
    );
  }
  setPlayback(
    request: Parameters<NonNullable<CorePort["setPlayback"]>>[0],
  ): void {
    this.#binding.set_playback(
      request.sessionId,
      request.pluginId,
      request.playing,
      request.rate,
    );
  }
}
