// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { test, expect } from "@playwright/test";
import {
  create,
  toBinary,
  fromBinary,
  CommandEnvelopeSchema,
  QueryEnvelopeSchema,
  HostFrameEnvelopeSchema,
  ResponseEnvelopeSchema,
  ResponseStatus,
  ErrorCode,
  ObjectLifecycle,
  ResourceUploadFormat,
  TextureColorSpace,
  SamplingFilter,
  SamplingAddress,
  type CommandPayload,
} from "@spaceeyes/core-sdk";
import type { WasmEngine } from "../public/wasm/spaceeyes_wasm.js";

test("presented selection wire contract rejects stale/deleted frames without writes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "卸载画布" }).click();
  await expect(page.getByTestId("phase")).toHaveText("已停止");
  await page.evaluate(async () => {
    const url = "/wasm/spaceeyes_wasm.js";
    const bindings = await import(/* webpackIgnore:true */ url);
    await bindings.default({ module_or_path: "/wasm/spaceeyes_wasm_bg.wasm" });
    const engine: WasmEngine = new bindings.WasmEngine(
      "pick-test",
      "TT",
      "explicit",
      0n,
      0,
    );
    (window as Window & { pickTestEngine?: WasmEngine }).pickTestEngine =
      engine;
    const canvas = document.createElement("canvas");
    canvas.id = "pick-test-canvas";
    canvas.width = canvas.height = 64;
    document.body.append(canvas);
    await engine.attach_canvas(canvas);
  });
  const context = {
    sessionId: "pick-test",
    protocolVersion: { major: 1, minor: 0, schemaId: "spaceeyes.core.v1" },
  };
  const exchange = async (
    method: "submit" | "query" | "present",
    bytes: Uint8Array,
  ) => {
    const result = await page.evaluate(
      async ({ method, bytes }) => {
        const engine = (window as Window & { pickTestEngine?: WasmEngine })
          .pickTestEngine!;
        return Array.from(await engine[method]("host", new Uint8Array(bytes)));
      },
      { method, bytes: Array.from(bytes) },
    );
    return fromBinary(ResponseEnvelopeSchema, new Uint8Array(result));
  };
  const command = (payload: CommandPayload, id: string) =>
    exchange(
      "submit",
      toBinary(
        CommandEnvelopeSchema,
        create(CommandEnvelopeSchema, {
          context: { ...context, requestId: id },
          payload,
        }),
      ),
    );
  const query = (sequence: bigint, x = 0, y = 0) =>
    exchange(
      "query",
      toBinary(
        QueryEnvelopeSchema,
        create(QueryEnvelopeSchema, {
          context: { ...context, requestId: "pick" },
          payload: {
            case: "pickPresented",
            value: { frameSequence: sequence, x, y },
          },
        }),
      ),
    );
  const capabilities = () =>
    exchange(
      "query",
      toBinary(
        QueryEnvelopeSchema,
        create(QueryEnvelopeSchema, {
          context: { ...context, requestId: "caps" },
          payload: { case: "capabilities", value: {} },
        }),
      ),
    );
  const resourceStats = () =>
    exchange(
      "query",
      toBinary(
        QueryEnvelopeSchema,
        create(QueryEnvelopeSchema, {
          context: { ...context, requestId: "stats" },
          payload: { case: "resourceStats", value: {} },
        }),
      ),
    );
  const present = () =>
    exchange(
      "present",
      toBinary(
        HostFrameEnvelopeSchema,
        create(HostFrameEnvelopeSchema, {
          context: { ...context, requestId: "present", timeGeneration: 0n },
          frame: {
            reference: { value: "root" },
            camera: { value: "camera" },
            width: 64,
            height: 64,
            elapsedNanos: 0n,
          },
        }),
      ),
    );
  const errorCode = (r: Awaited<ReturnType<typeof query>>) =>
    r.payload.case === "error" ? r.payload.value.code : undefined;
  try {
    expect(errorCode(await query(0n))).toBe(ErrorCode.SNAPSHOT_EXPIRED);
    expect(
      (
        await command(
          {
            case: "spatial",
            value: {
              expectedRevision: 0n,
              action: {
                case: "registerRoot",
                value: { frameId: { value: "root" } },
              },
            },
          },
          "root",
        )
      ).status,
    ).toBe(ResponseStatus.COMPLETED);
    // The typed asset is larger than the public message cap; every chunk stays bounded.
    const rgba = new Uint8Array(1024 * 512 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([0, 255, 64, 255], i);
    const began = await command(
      {
        case: "resource",
        value: {
          action: {
            case: "beginUpload",
            value: {
              resourceId: { value: "uploaded-texture" },
              totalBytes: BigInt(rgba.length),
              source: {
                sourceId: "self-generated:green",
                sourceVersion: "v1",
                sha256: new Uint8Array(
                  createHash("sha256").update(rgba).digest(),
                ),
              },
              format: ResourceUploadFormat.RGBA8,
              width: 1024,
              height: 512,
              colorSpace: TextureColorSpace.LINEAR,
            },
          },
        },
      },
      "upload:begin",
    );
    expect(began.payload.case).toBe("upload");
    if (began.payload.case !== "upload") throw new Error("expected upload");
    const uploadId = began.payload.value.uploadId;
    for (let offset = 0; offset < rgba.length; offset += 262144) {
      expect(
        (
          await command(
            {
              case: "resource",
              value: {
                action: {
                  case: "appendUpload",
                  value: {
                    uploadId,
                    offset: BigInt(offset),
                    data: rgba.slice(offset, offset + 262144),
                  },
                },
              },
            },
            `upload:${offset}`,
          )
        ).status,
      ).toBe(ResponseStatus.COMPLETED);
    }
    expect(
      (
        await command(
          {
            case: "resource",
            value: { action: { case: "finishUpload", value: { uploadId } } },
          },
          "upload:finish",
        )
      ).status,
    ).toBe(ResponseStatus.COMPLETED);
    expect(
      (
        await command(
          {
            case: "sceneTransaction",
            value: {
              expectedRevision: 0n,
              commands: [
                {
                  action: {
                    case: "create",
                    value: {
                      object: {
                        objectId: { value: "body" },
                        frameId: { value: "root" },
                        visible: true,
                        lifecycle: ObjectLifecycle.ACTIVE,
                        sphere: {
                          radiusM: 1,
                          baseColor: { r: 1, g: 1, b: 1 },
                          material: {
                            baseColor: { r: 1, g: 1, b: 1 },
                            texture: { value: "uploaded-texture" },
                            filter: SamplingFilter.NEAREST,
                            address: SamplingAddress.CLAMP,
                            unlit: true,
                          },
                        },
                      },
                    },
                  },
                },
                {
                  action: {
                    case: "create",
                    value: {
                      object: {
                        objectId: { value: "camera" },
                        frameId: { value: "root" },
                        visible: true,
                        lifecycle: ObjectLifecycle.ACTIVE,
                        camera: {
                          positionM: { x: 0, y: 0, z: 6 },
                          orientation: { w: 1, x: 0, y: 0, z: 0 },
                          projection: {
                            kind: {
                              case: "perspective",
                              value: {
                                verticalFovRadians: 1,
                                nearM: 0.1,
                                farM: 100,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
          "scene",
        )
      ).status,
    ).toBe(ResponseStatus.COMPLETED);
    expect(
      (
        await command(
          {
            case: "lifecycle",
            value: { action: { case: "start", value: {} } },
          },
          "start",
        )
      ).status,
    ).toBe(ResponseStatus.COMPLETED);
    const frame = await present();
    expect(frame.status).toBe(ResponseStatus.COMPLETED);
    const stats = await resourceStats();
    expect(stats.payload.case).toBe("resourceStats");
    if (stats.payload.case === "resourceStats") {
      expect(stats.payload.value.cpuUsedBytes).toBe(BigInt(rgba.length));
      expect(stats.payload.value.gpuUsedBytes).toBe(48n * 1024n * 1024n);
      expect(stats.payload.value.stagingUsedBytes).toBe(0n);
      expect(stats.payload.value.totalUsedBytes).toBe(
        stats.payload.value.gpuUsedBytes + BigInt(rgba.length),
      );
    }
    const pixels = PNG.sync.read(
      await page.locator("#pick-test-canvas").screenshot(),
    );
    const center = (32 * pixels.width + 32) * 4;
    expect(pixels.data[center + 1]).toBeGreaterThan(pixels.data[center] + 100);
    expect(pixels.data[center + 1]).toBeGreaterThan(
      pixels.data[center + 2] + 100,
    );
    const before = await capabilities();
    const hit = await query(frame.frameSequence);
    expect(hit.payload.case).toBe("selection");
    if (hit.payload.case === "selection") {
      expect(hit.payload.value.object?.objectId?.value).toBe("body");
      expect(hit.payload.value.object?.sphere?.radiusM).toBe(1);
      expect(hit.payload.value.frameSequence).toBe(frame.frameSequence);
      expect(hit.payload.value.sceneRevision).toBe(
        frame.committedSceneRevision,
      );
    }
    const miss = await query(frame.frameSequence, 0.95, 0.95);
    expect(miss.payload.case).toBe("selection");
    if (miss.payload.case === "selection")
      expect(miss.payload.value.object).toBeUndefined();
    expect(errorCode(await query(frame.frameSequence + 1n))).toBe(
      ErrorCode.SNAPSHOT_EXPIRED,
    );
    expect(errorCode(await query(frame.frameSequence, NaN))).toBe(
      ErrorCode.INVALID_ARGUMENT,
    );
    expect(await capabilities()).toEqual(before);
    expect(
      (
        await command(
          {
            case: "sceneTransaction",
            value: {
              expectedRevision: frame.committedSceneRevision,
              commands: [
                {
                  action: {
                    case: "remove",
                    value: { objectId: { value: "body" } },
                  },
                },
              ],
            },
          },
          "delete",
        )
      ).status,
    ).toBe(ResponseStatus.COMPLETED);
    expect(errorCode(await query(frame.frameSequence))).toBe(
      ErrorCode.SNAPSHOT_EXPIRED,
    );
    const next = await present();
    expect(next.status).toBe(ResponseStatus.COMPLETED);
    const removed = await query(next.frameSequence);
    expect(removed.payload.case).toBe("selection");
    if (removed.payload.case === "selection")
      expect(removed.payload.value.object).toBeUndefined();
    const stopped = await command(
      { case: "lifecycle", value: { action: { case: "stop", value: {} } } },
      "stop",
    );
    if (stopped.payload.case === "session")
      expect(stopped.payload.value.resourceUsedBytes).toBe(0n);
    expect(errorCode(await query(next.frameSequence))).toBe(
      ErrorCode.ENGINE_UNAVAILABLE,
    );
    const released = await resourceStats();
    expect(released.payload.case).toBe("resourceStats");
    if (released.payload.case === "resourceStats") {
      expect(released.payload.value.totalUsedBytes).toBe(0n);
      expect(released.payload.value.cpuUsedBytes).toBe(0n);
      expect(released.payload.value.gpuUsedBytes).toBe(0n);
      expect(released.payload.value.stagingUsedBytes).toBe(0n);
    }
  } finally {
    await page.evaluate(() => {
      const target = window as Window & { pickTestEngine?: WasmEngine };
      target.pickTestEngine?.free();
      delete target.pickTestEngine;
      document.getElementById("pick-test-canvas")?.remove();
    });
  }
});
