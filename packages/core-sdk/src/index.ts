// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import {
  create,
  fromBinary,
  toBinary,
  ScalarType,
  type DescMessage,
  type MessageInitShape,
} from "@bufbuild/protobuf";
import {
  CommandEnvelopeSchema,
  QueryEnvelopeSchema,
  ResponseEnvelopeSchema,
  ResponseStatus,
  type ResponseEnvelope,
  type Capabilities,
} from "./gen/spaceeyes/core/v1/core_pb.js";
import { ErrorCode } from "./gen/spaceeyes/core/v1/common_pb.js";
export * from "./gen/spaceeyes/core/v1/core_pb.js";
export * from "./gen/spaceeyes/core/v1/common_pb.js";
export * from "./gen/spaceeyes/core/v1/spatial_pb.js";
export * from "./gen/spaceeyes/core/v1/scene_pb.js";
export * from "./gen/spaceeyes/core/v1/time_pb.js";
export * from "./gen/spaceeyes/core/v1/rendering_pb.js";
export * from "./gen/spaceeyes/core/v1/resources_pb.js";
export * from "./gen/spaceeyes/core/v1/project_pb.js";
export { create, fromBinary, toBinary } from "@bufbuild/protobuf";

export interface ByteTransport {
  submit(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
  query(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
export interface WasmByteEngine {
  submit(principal: string, bytes: Uint8Array): Uint8Array;
  query(principal: string, bytes: Uint8Array): Uint8Array;
}
/** Host-only identity injection. The host owns authorization, shutdown and engine.free(). */
export function wasmTransport(
  engine: WasmByteEngine,
  authenticatedPrincipal: string,
): ByteTransport {
  identifier(authenticatedPrincipal);
  return {
    submit: (bytes) => engine.submit(authenticatedPrincipal, bytes),
    query: (bytes) => engine.query(authenticatedPrincipal, bytes),
  };
}
export class CoreRemoteError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = "CoreRemoteError";
  }
}
export class UnsupportedCapabilityError extends Error {
  constructor(readonly capability: string) {
    super(`Unsupported capability: ${capability}`);
    this.name = "UnsupportedCapabilityError";
  }
}
export type CommandPayload = NonNullable<
  MessageInitShape<typeof CommandEnvelopeSchema>["payload"]
>;
export type QueryPayload = NonNullable<
  MessageInitShape<typeof QueryEnvelopeSchema>["payload"]
>;
export interface RequestOptions {
  requestId: string;
  expectedSceneRevision?: bigint;
  timeGeneration?: bigint;
}
const VERSION = { major: 1, minor: 0, schemaId: "spaceeyes.core.v1" };
const BOOTSTRAP_LIMIT = 1024 * 1024;
function identifier(value: string): void {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    new TextEncoder().encode(value).length > 256
  )
    throw new TypeError("Identifier must contain 1..256 UTF-8 bytes");
}
const int64 = new Set([
  ScalarType.INT64,
  ScalarType.SINT64,
  ScalarType.SFIXED64,
  ScalarType.UINT64,
  ScalarType.FIXED64,
]);
/** Validate 64-bit inputs from the generated descriptors, including untyped JS callers. */
function exactIntegers(schema: DescMessage, input: unknown): void {
  const object = input as Record<string, unknown>;
  for (const field of schema.fields) {
    let value = object[field.localName];
    if (field.oneof) {
      const union = object[field.oneof.localName] as
        | { case?: string; value?: unknown }
        | undefined;
      value = union?.case === field.localName ? union.value : undefined;
    }
    if (value === undefined) continue;
    if (field.fieldKind === "message") exactIntegers(field.message, value);
    else if (field.fieldKind === "list" && field.listKind === "message") {
      for (const item of value as unknown[]) exactIntegers(field.message, item);
    } else if (field.fieldKind === "scalar" && int64.has(field.scalar)) {
      const unsigned =
        field.scalar === ScalarType.UINT64 ||
        field.scalar === ScalarType.FIXED64;
      const min = unsigned ? 0n : -(1n << 63n);
      const max = unsigned ? (1n << 64n) - 1n : (1n << 63n) - 1n;
      if (typeof value !== "bigint" || value < min || value > max)
        throw new TypeError(`${field.name} requires an in-range bigint`);
    }
  }
}
function commandOperation(payload: CommandPayload): string {
  if (payload.case === "sceneTransaction") return "scene.transaction";
  if (!payload.case) throw new TypeError("Missing command payload");
  const action = payload.value.action?.case;
  if (!action) throw new TypeError("Missing command action");
  return `${payload.case === "resource" ? "resources" : payload.case}.${action.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}`;
}
function queryOperation(payload: QueryPayload): string {
  if (!payload.case) throw new TypeError("Missing query payload");
  return (
    "query." + payload.case.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())
  );
}
/** Transport adapter only: no authoritative scene/time cache, retries, identity or GPU state. */
export class CoreClient {
  private operations = new Set<string>();
  private connected = false;
  private maxMessageBytes = BOOTSTRAP_LIMIT;
  constructor(
    private readonly transport: ByteTransport,
    private readonly sessionId: string,
  ) {
    identifier(sessionId);
  }
  supports(operation: string): boolean {
    return this.connected && this.operations.has(operation);
  }
  private context(
    options: RequestOptions,
  ): MessageInitShape<typeof CommandEnvelopeSchema>["context"] {
    identifier(options.requestId);
    return {
      requestId: options.requestId,
      sessionId: this.sessionId,
      protocolVersion: VERSION,
      ...(options.expectedSceneRevision === undefined
        ? {}
        : { expectedSceneRevision: options.expectedSceneRevision }),
      ...(options.timeGeneration === undefined
        ? {}
        : { timeGeneration: options.timeGeneration }),
    };
  }
  private async exchange(
    route: "submit" | "query",
    bytes: Uint8Array,
    requestId: string,
    expectedPayload: string,
  ): Promise<ResponseEnvelope> {
    if (bytes.length > this.maxMessageBytes)
      throw new RangeError("Message exceeds negotiated byte limit");
    const result = await this.transport[route](bytes);
    if (!(result instanceof Uint8Array) || result.length > this.maxMessageBytes)
      throw new RangeError("Invalid or oversized response");
    const response = fromBinary(ResponseEnvelopeSchema, result);
    if (response.requestId !== requestId)
      throw new Error("Response request ID mismatch");
    if (
      response.status === ResponseStatus.REJECTED &&
      response.payload.case === "error"
    ) {
      if (response.payload.value.requestId !== requestId)
        throw new Error("Error request ID mismatch");
      throw new CoreRemoteError(
        response.payload.value.code,
        requestId,
        response.payload.value.message,
      );
    }
    if (
      response.status !== ResponseStatus.COMPLETED ||
      response.payload.case !== expectedPayload
    )
      throw new Error("Unexpected response status or payload");
    return response;
  }
  /** Read fresh metadata; support does not grant authority or imply current lifecycle availability. */
  async connect(
    required: readonly string[] = [],
    requestId = "sdk:discover",
  ): Promise<Capabilities> {
    this.connected = false;
    this.operations.clear();
    this.maxMessageBytes = BOOTSTRAP_LIMIT;
    const message = create(QueryEnvelopeSchema, {
      context: this.context({ requestId }),
      payload: { case: "capabilities", value: {} },
    });
    const response = await this.exchange(
      "query",
      toBinary(QueryEnvelopeSchema, message),
      requestId,
      "capabilities",
    );
    if (response.payload.case !== "capabilities")
      throw new Error("Missing capabilities");
    const caps = response.payload.value;
    const version = caps.protocolVersion;
    if (
      !version ||
      version.major !== VERSION.major ||
      version.minor !== VERSION.minor ||
      version.schemaId !== VERSION.schemaId
    )
      throw new Error("Incompatible core protocol");
    if (
      !caps.limits ||
      caps.limits.maxMessageBytes <= 0 ||
      caps.limits.maxMessageBytes > BOOTSTRAP_LIMIT ||
      caps.limits.maxIdentifierBytes !== 256
    )
      throw new Error("Unsupported protocol limits");
    const operations = new Set(caps.operations);
    for (const operation of required)
      if (!operations.has(operation))
        throw new UnsupportedCapabilityError(operation);
    this.operations = operations;
    this.maxMessageBytes = caps.limits.maxMessageBytes;
    this.connected = true;
    return caps;
  }
  async command(
    payload: CommandPayload,
    options: RequestOptions,
  ): Promise<ResponseEnvelope> {
    const operation = commandOperation(payload);
    this.require(operation);
    const message = create(CommandEnvelopeSchema, {
      context: this.context(options),
      payload,
    });
    exactIntegers(CommandEnvelopeSchema, message);
    const expected =
      payload.case === "resource"
        ? payload.value.action?.case === "beginUpload" ||
          payload.value.action?.case === "appendUpload"
          ? "upload"
          : "resource"
        : payload.case === "spatial"
          ? "spatial"
          : payload.case === "lifecycle"
            ? "session"
            : "scene";
    return this.exchange(
      "submit",
      toBinary(CommandEnvelopeSchema, message),
      options.requestId,
      expected,
    );
  }
  async query(
    payload: QueryPayload,
    options: RequestOptions,
  ): Promise<ResponseEnvelope> {
    this.require(queryOperation(payload));
    const message = create(QueryEnvelopeSchema, {
      context: this.context(options),
      payload,
    });
    exactIntegers(QueryEnvelopeSchema, message);
    const expected =
      payload.case === "upload"
        ? "upload"
        : payload.case === "sessionStatus"
          ? "session"
          : payload.case === "resolveFrame"
            ? "frame"
            : payload.case === "pickPresented"
              ? "selection"
              : payload.case === "cameraState"
                ? "camera"
                : payload.case === "resourceStats"
                  ? "resourceStats"
                  : payload.case === "projectExport"
                    ? "project"
                    : payload.case === "listObjects"
                      ? "objects"
                      : "capabilities";
    return this.exchange(
      "query",
      toBinary(QueryEnvelopeSchema, message),
      options.requestId,
      expected,
    );
  }
  private require(operation: string): void {
    if (!this.connected)
      throw new Error("Connect and negotiate capabilities first");
    if (!this.operations.has(operation))
      throw new UnsupportedCapabilityError(operation);
  }
}
