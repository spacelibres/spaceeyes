import type { CorePort, FocusRequest } from './core-port.ts';
import type { ObjectState } from './state-contract.ts';

/** Structural surface of wasm-bindgen's generated WasmCore; owned by the host. */
export interface WasmCoreBinding {
  open_session(session: string, plugin: string, camera: boolean, data: boolean, time: boolean): void;
  release_session(session: string): void;
  publish_object(session: string, plugin: string, target: string, sampleJson: string): void;
  remove_object(session: string, plugin: string, target: string): void;
  focus(session: string, plugin: string, target: string): void;
  seek(session: string, plugin: string, epoch: number): void;
  set_playback(session: string, plugin: string, playing: boolean, rate: number): void;
}

export class WasmCorePort implements CorePort {
  #binding: WasmCoreBinding;
  constructor(binding: WasmCoreBinding) { this.#binding = binding; }
  openSession(request: Parameters<CorePort['openSession']>[0]): void {
    this.#binding.open_session(request.sessionId, request.pluginId, request.cameraControl, request.dataPublish, request.timeControl);
  }
  releaseSession(sessionId: string): void { this.#binding.release_session(sessionId); }
  focus(request: FocusRequest): void { this.#binding.focus(request.sessionId, request.pluginId, request.targetId); }
  publishObject(request: FocusRequest & { readonly state: Readonly<ObjectState> }): void {
    this.#binding.publish_object(request.sessionId, request.pluginId, request.targetId, JSON.stringify(request.state));
  }
  removeObject(request: FocusRequest): void { this.#binding.remove_object(request.sessionId, request.pluginId, request.targetId); }
  seek(request: Parameters<NonNullable<CorePort['seek']>>[0]): void {
    this.#binding.seek(request.sessionId, request.pluginId, request.epochTdbSeconds);
  }
  setPlayback(request: Parameters<NonNullable<CorePort['setPlayback']>>[0]): void {
    this.#binding.set_playback(request.sessionId, request.pluginId, request.playing, request.rate);
  }
}
