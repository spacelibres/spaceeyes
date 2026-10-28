// Internal host-to-core adapter boundary, not a public wire protocol.
// An implementation must forward to Rust/Bevy and validate target existence there.
import type { ObjectState } from './state-contract.ts';
export interface FocusRequest {
  readonly pluginId: string;
  readonly sessionId: string;
  readonly targetId: string;
}
export interface CorePort {
  openSession(request: { readonly pluginId: string; readonly sessionId: string; readonly cameraControl: boolean;
    readonly dataPublish: boolean; readonly timeControl: boolean }): void;
  focus(request: FocusRequest): void;
  publishObject?(request: FocusRequest & { readonly state: Readonly<ObjectState> }): void;
  removeObject?(request: FocusRequest): void;
  seek?(request: { readonly pluginId: string; readonly sessionId: string; readonly epochTdbSeconds: number }): void;
  setPlayback?(request: { readonly pluginId: string; readonly sessionId: string; readonly playing: boolean; readonly rate: number }): void;
  releaseSession(sessionId: string): void | Promise<void>;
}
