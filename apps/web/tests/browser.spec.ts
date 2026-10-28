// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import {
  create,
  toBinary,
  fromBinary,
  CommandEnvelopeSchema,
  QueryEnvelopeSchema,
  HostFrameEnvelopeSchema,
  ResponseEnvelopeSchema,
  ErrorCode,
  ResponseStatus,
  ObjectLifecycle,
  type CommandPayload,
  HostFrameSchema,
  RequestContextSchema,
  type HostFrame,
} from "@spaceeyes/core-sdk";
function colored(bytes: Buffer): number {
  const image = PNG.sync.read(bytes);
  let count = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i],
      g = image.data[i + 1],
      b = image.data[i + 2];
    if (
      (r > 50 && r > g * 1.4 && r > b * 1.4) ||
      (b > 50 && b > r * 1.4 && b > g * 1.4)
    )
      count++;
  }
  return count;
}

test("picking reads the displayed frame, clears on empty space and survives resize/remount", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  const canvas = page.getByTestId("scene-canvas");
  const hitCenter = async () => {
    const box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.getByTestId("selected-object")).toHaveText("demo:body");
    await expect(page.getByTestId("selected-kind")).toHaveText("球体");
    await expect(page.getByTestId("selected-frame")).toHaveText("demo:root");
  };
  await hitCenter();
  await canvas.click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId("selection-status")).toHaveText("未命中对象");
  await expect(page.getByTestId("selected-object")).toHaveCount(0);
  await page.setViewportSize({ width: 720, height: 1000 });
  await hitCenter();
  await page.screenshot({
    path: "test-results/spaceeyes-selection-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "卸载画布" }).click();
  await expect(page.getByTestId("selected-object")).toHaveCount(0);
  await page.getByRole("button", { name: "重新挂载" }).click();
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await hitCenter();
});
test("actual Surface pixels, camera, clock, resize and teardown/remount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  const canvas = page.getByTestId("scene-canvas");
  await expect
    .poll(async () => colored(await canvas.screenshot()))
    .toBeGreaterThan(1000);
  await page.screenshot({ path: "/tmp/spaceeyes-browser.png", fullPage: true });
  const before = await canvas.screenshot();
  expect(colored(before)).toBeGreaterThan(1000);
  const initialTime = await page
    .getByTestId("clock")
    .getAttribute("data-nanos");
  expect(initialTime).toBe("0");
  await page.getByRole("button", { name: "视角 +15°" }).click();
  const initialFrames = Number(await page.getByTestId("frames").textContent());
  await expect
    .poll(async () => Number(await page.getByTestId("frames").textContent()))
    .toBeGreaterThan(initialFrames + 2);
  const after = await canvas.screenshot();
  expect(colored(after)).toBeGreaterThan(500);
  expect(after.equals(before)).toBe(false);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(async () =>
      BigInt((await page.getByTestId("clock").getAttribute("data-nanos"))!),
    )
    .toBeGreaterThan(0n);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeEnabled();
  const paused = await page.getByTestId("clock").getAttribute("data-nanos");
  const frames = Number(await page.getByTestId("frames").textContent());
  await expect
    .poll(async () => Number(await page.getByTestId("frames").textContent()))
    .toBeGreaterThan(frames + 3);
  expect(await page.getByTestId("clock").getAttribute("data-nanos")).toBe(
    paused,
  );
  const width = await canvas.getAttribute("width");
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(() => canvas.getAttribute("width")).not.toBe(width);
  expect(colored(await canvas.screenshot())).toBeGreaterThan(300);
  await page.screenshot({
    path: "/tmp/spaceeyes-browser-resized.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "卸载画布" }).click();
  await expect(canvas).toHaveCount(0);
  await expect(page.getByTestId("phase")).toHaveText("已停止");
  await expect(page.getByTestId("resources")).toHaveAttribute(
    "data-bytes",
    "0",
  );
  await page.getByRole("button", { name: "重新挂载" }).click();
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await expect(page.getByTestId("clock")).toHaveAttribute("data-nanos", "0");
  expect(
    colored(await page.getByTestId("scene-canvas").screenshot()),
  ).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
test("unsupported WebGPU is an explicit error with no placeholder rendering", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("alert").filter({ hasText: "不支持 WebGPU" }),
  ).toContainText("不支持 WebGPU");
  await expect(page.getByTestId("phase")).toHaveText("错误");
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
  await expect(page.getByTestId("frames")).toHaveText("0");
  await expect(page.getByTestId("resources")).toHaveAttribute(
    "data-bytes",
    "0",
  );
});
test("unmount during asynchronous initialization cannot revive an old canvas", async ({
  page,
}) => {
  await page.route("**/spaceeyes_wasm_bg.wasm", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "卸载画布" }).click();
    await page.getByRole("button", { name: "重新挂载" }).click();
  }
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await expect(page.getByTestId("scene-canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "卸载画布" }).click();
  await expect(page.getByTestId("phase")).toHaveText("已停止");
  await expect(page.getByTestId("resources")).toHaveAttribute(
    "data-bytes",
    "0",
  );
  expect(errors).toEqual([]);
});
test("host frame preconditions protect time and do not consume command history", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "卸载画布" }).click();
  await expect(page.getByTestId("phase")).toHaveText("已停止");
  const context = {
    sessionId: "frame-test",
    protocolVersion: { major: 1, minor: 0, schemaId: "spaceeyes.core.v1" },
  };
  const command = (payload: CommandPayload, id: string) =>
    Array.from(
      toBinary(
        CommandEnvelopeSchema,
        create(CommandEnvelopeSchema, {
          context: { ...context, requestId: id, expectedSceneRevision: 0n },
          payload,
        }),
      ),
    );
  const commands = [
    command(
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
    ),
    command(
      {
        case: "scene",
        value: {
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
                        verticalFovRadians: Math.PI / 3,
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
      },
      "camera",
    ),
    command(
      { case: "lifecycle", value: { action: { case: "start", value: {} } } },
      "start",
    ),
    command(
      { case: "time", value: { action: { case: "play", value: {} } } },
      "play",
    ),
  ];
  const query = (capabilities = false) =>
    Array.from(
      toBinary(
        QueryEnvelopeSchema,
        create(QueryEnvelopeSchema, {
          context: { ...context, requestId: "query" },
          payload: capabilities
            ? { case: "capabilities", value: {} }
            : { case: "sessionStatus", value: {} },
        }),
      ),
    );
  const request = (
    id: string,
    patch: Partial<Pick<HostFrame, "width" | "height" | "elapsedNanos">> & {
      camera?: string;
    } = {},
    generation: bigint | undefined = 0n,
  ) =>
    Array.from(
      toBinary(
        HostFrameEnvelopeSchema,
        create(HostFrameEnvelopeSchema, {
          context: create(RequestContextSchema, {
            ...context,
            requestId: id,
            timeGeneration: generation,
          }),
          frame: create(HostFrameSchema, {
            reference: { value: "root" },
            camera: { value: patch.camera ?? "camera" },
            width: patch.width ?? 32,
            height: patch.height ?? 32,
            elapsedNanos: patch.elapsedNanos ?? 50000000n,
          }),
        }),
      ),
    );
  const frames = [
    request("stale", {}, 99n),
    request("size", { width: 0 }),
    request("time", { elapsedNanos: 250000001n }),
    request("camera", {
      camera: "missing",
    }),
    request("valid"),
  ];
  const stop = command(
    { case: "lifecycle", value: { action: { case: "stop", value: {} } } },
    "stop",
  );
  const raw = await page.evaluate(
    async ({ commands, frames, status, caps, stop }) => {
      const url = "/wasm/spaceeyes_wasm.js";
      const bindings = await import(/* webpackIgnore: true */ url);
      await bindings.default({
        module_or_path: "/wasm/spaceeyes_wasm_bg.wasm",
      });
      const engine = new bindings.WasmEngine(
        "frame-test",
        "TT",
        "prototype",
        0n,
        0,
      );
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      document.body.append(canvas);
      const results: number[][] = [];
      try {
        await engine.attach_canvas(canvas);
        for (const bytes of commands)
          results.push(
            Array.from(engine.submit("host", new Uint8Array(bytes))),
          );
        results.push(Array.from(engine.query("host", new Uint8Array(caps))));
        for (const bytes of frames)
          results.push(
            Array.from(await engine.present("host", new Uint8Array(bytes))),
          );
        results.push(Array.from(engine.query("host", new Uint8Array(caps))));
        results.push(Array.from(engine.query("host", new Uint8Array(status))));
        results.push(Array.from(engine.submit("host", new Uint8Array(stop))));
        return results;
      } finally {
        engine.free();
        canvas.remove();
      }
    },
    { commands, frames, status: query(), caps: query(true), stop },
  );
  const results = raw.map((bytes) =>
    fromBinary(ResponseEnvelopeSchema, new Uint8Array(bytes)),
  );
  for (const response of results.slice(0, 4))
    expect(response.status).toBe(ResponseStatus.COMPLETED);
  const errors = results
    .slice(5, 9)
    .map((r) =>
      r.payload.case === "error" ? r.payload.value.code : undefined,
    );
  expect(errors).toEqual([
    ErrorCode.STALE_GENERATION,
    ErrorCode.INVALID_ARGUMENT,
    ErrorCode.INVALID_ARGUMENT,
    ErrorCode.UNKNOWN_OBJECT,
  ]);
  const before = results[4].payload;
  const after = results[10].payload;
  expect(before.case).toBe("capabilities");
  expect(after.case).toBe("capabilities");
  if (before.case === "capabilities" && after.case === "capabilities")
    expect(after.value.limits!.commandHistoryRemaining).toBe(
      before.value.limits!.commandHistoryRemaining,
    );
  const current = results[11].payload;
  expect(current.case).toBe("session");
  if (current.case === "session") {
    expect(current.value.clock!.instant!.nanos).toBe(50000000);
    expect(current.value.resourceUsedBytes).toBe(50331648n);
  }
  const stopped = results[12].payload;
  expect(stopped.case).toBe("session");
  if (stopped.case === "session")
    expect(stopped.value.resourceUsedBytes).toBe(0n);
});

test("device loss stops presentation and clears the session instead of freezing", async ({
  page,
}) => {
  await page.addInitScript({
    content: `
    const request=GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice=async function(...args) {
      const device=await request.apply(this,args);window.__spaceeyesTestDevice=device;return device;
    };
  `,
  });
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await page.evaluate("window.__spaceeyesTestDevice.destroy()");
  await expect(page.getByTestId("phase")).toHaveText("错误");
  await expect(page.getByTestId("resources")).toHaveAttribute(
    "data-bytes",
    "0",
  );
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeDisabled();
});

test("selected mesh focus and follow use core camera state and reset restores the view", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  const canvas = page.getByTestId("scene-canvas");
  await expect(
    page.getByRole("button", { name: "聚焦对象", exact: true }),
  ).toBeDisabled();
  const before = await canvas.screenshot();
  const pixels = PNG.sync.read(before);
  const row = Math.floor(pixels.height / 2);
  let edge = -1;
  for (let x = pixels.width - 1; x > pixels.width / 2; x--) {
    const i = (row * pixels.width + x) * 4;
    if (pixels.data[i] > 50 || pixels.data[i + 2] > 50) {
      edge = x;
      break;
    }
  }
  expect(edge).toBeGreaterThan(pixels.width / 2);
  await canvas.click({ position: { x: edge - 8, y: row } });
  await expect(page.getByTestId("selected-object")).toHaveText(
    "demo:mesh-object",
  );
  await page.getByRole("button", { name: "聚焦对象", exact: true }).click();
  await expect(page.getByTestId("camera-mode")).toHaveText("自由视角");
  await expect(page.getByTestId("selected-object")).toHaveCount(0);
  const selectCenter = async () => {
    const box = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect(page.getByTestId("selected-object")).toHaveText(
      "demo:mesh-object",
    );
  };
  await selectCenter();
  await page.getByRole("button", { name: "跟随对象", exact: true }).click();
  await expect(page.getByTestId("camera-mode")).toHaveText("跟随目标");
  await expect(page.getByTestId("camera-target")).toHaveText(
    "demo:mesh-object",
  );
  await expect
    .poll(async () => !(await canvas.screenshot()).equals(before))
    .toBe(true);
  await page.getByRole("button", { name: "恢复视角", exact: true }).click();
  await expect(page.getByTestId("camera-mode")).toHaveText("自由视角");
  await expect(page.getByTestId("camera-target")).toHaveCount(0);
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId("selected-object")).toHaveText("demo:body");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await page.screenshot({
    path: "test-results/spaceeyes-camera-controls.png",
    fullPage: true,
  });
});

test("time controls preserve nanoseconds, signed playback and nonfatal input errors", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  const input = page.getByLabel("目标时间 / 历元相对秒");
  const jump = page.getByRole("button", { name: "跳转", exact: true });
  await input.fill("-0.5");
  await jump.click();
  await expect(page.getByTestId("clock")).toHaveText("-0.500000000");
  await expect(page.getByTestId("clock")).toHaveAttribute(
    "data-nanos",
    "-500000000",
  );
  await page.getByRole("button", { name: "步退1秒", exact: true }).click();
  await expect(page.getByTestId("clock")).toHaveText("-1.500000000");
  await page.getByRole("button", { name: "步进1秒", exact: true }).click();
  await expect(page.getByTestId("clock")).toHaveText("-0.500000000");
  await input.fill("9007199254740993.000000001");
  await jump.click();
  await expect(page.getByTestId("clock")).toHaveAttribute(
    "data-nanos",
    "9007199254740993000000001",
  );
  await input.fill("1e3");
  await jump.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "时间操作未完成" }),
  ).toContainText("十进制秒");
  await expect(page.getByTestId("clock")).toHaveAttribute(
    "data-nanos",
    "9007199254740993000000001",
  );
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await input.fill("0");
  await jump.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "时间操作未完成" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("clock")).toHaveAttribute("data-nanos", "0");
  await page.getByLabel("播放倍速").selectOption("-0.25");
  await expect(page.getByLabel("播放倍速")).toHaveValue("-0.25");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect(jump).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "步进1秒", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(async () =>
      BigInt((await page.getByTestId("clock").getAttribute("data-nanos"))!),
    )
    .toBeLessThan(0n);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(jump).toBeEnabled();
  const stopped = await page.getByTestId("clock").getAttribute("data-nanos");
  const frames = Number(await page.getByTestId("frames").textContent());
  await expect
    .poll(async () => Number(await page.getByTestId("frames").textContent()))
    .toBeGreaterThan(frames + 3);
  expect(await page.getByTestId("clock").getAttribute("data-nanos")).toBe(
    stopped,
  );
  await page.screenshot({
    path: "test-results/spaceeyes-time-controls.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "卸载画布", exact: true }).click();
  await page.getByRole("button", { name: "重新挂载", exact: true }).click();
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await expect(page.getByTestId("clock")).toHaveAttribute("data-nanos", "0");
  await expect(page.getByLabel("播放倍速")).toHaveValue("1");
});

test("UTC display and seek are converted by the Rust core", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("phase")).toHaveText("运行中");
  await expect(page.getByTestId("utc-clock")).toContainText(
    "2000-01-01 11:58:55",
  );
  const utc = page.getByLabel("UTC 日期时间（ISO 8601）");
  const jump = page.getByRole("button", { name: "按 UTC 跳转", exact: true });
  await utc.fill("2026-10-28T00:00:00Z");
  await jump.click();
  await expect(page.getByTestId("utc-clock")).toContainText(
    "2026-10-28 00:00:00.000000000 UTC",
  );
  expect(
    BigInt((await page.getByTestId("clock").getAttribute("data-nanos"))!),
  ).toBeGreaterThan(0n);
  await utc.fill("2016-12-30T23:59:60Z");
  await jump.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "时间操作未完成" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("utc-clock")).toContainText(
    "2026-10-28 00:00:00.000000000 UTC",
  );
  await utc.fill("2027-05-20T00:00:00Z");
  await jump.click();
  await expect(page.getByTestId("utc-clock")).toContainText("连续 UTC");
  await page.screenshot({
    path: "test-results/spaceeyes-utc-time.png",
    fullPage: true,
  });
});
