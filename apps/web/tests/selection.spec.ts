// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
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
                        sphere: { radiusM: 1, baseColor: { r: 1, g: 0, b: 0 } },
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
  } finally {
    await page.evaluate(() => {
      const target = window as Window & { pickTestEngine?: WasmEngine };
      target.pickTestEngine?.free();
      delete target.pickTestEngine;
      document.getElementById("pick-test-canvas")?.remove();
    });
  }
});
