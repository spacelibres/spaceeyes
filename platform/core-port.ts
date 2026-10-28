// Internal host-to-core adapter boundary, not a public wire protocol.
// An implementation must forward to Rust/Bevy and validate target existence there.
export interface FocusRequest {
  readonly pluginId: string;
  readonly sessionId: string;
  readonly targetId: string;
}
export interface CorePort {
  openSession(request: { readonly pluginId: string; readonly sessionId: string; readonly cameraControl: boolean }): void;
  focus(request: FocusRequest): void;
  releaseSession(sessionId: string): void | Promise<void>;
}
