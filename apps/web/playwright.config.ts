// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  retries: 0,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 1280, height: 850 },
    deviceScaleFactor: 1,
    launchOptions: {
      executablePath:
        process.env.SPACEEYES_BROWSER_PATH ??
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args:
        process.platform === "win32"
          ? ["--enable-unsafe-webgpu"]
          : [
              "--enable-unsafe-webgpu",
              "--use-angle=swiftshader",
              "--enable-features=Vulkan",
              "--use-vulkan=swiftshader",
            ],
    },
  },
  webServer: {
    command: "npm run start --workspace @spaceeyes/web",
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 60000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
