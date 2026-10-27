// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors
import { expect, test } from "@playwright/test";

/** Synthetic circular `orb` bytes; no NASA fixture is used. */
function syntheticOrb(): Uint8Array {
  const bytes: number[] = [];
  const i16 = (value: number) => {
    const buffer = new ArrayBuffer(2);
    new DataView(buffer).setInt16(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  const i32 = (value: number) => {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setInt32(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  const f64 = (value: number) => {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    bytes.push(...new Uint8Array(buffer));
  };
  const name = (value: string) => {
    for (const character of value) bytes.push(character.charCodeAt(0));
    bytes.push(0);
  };
  i16(2);
  name("orb");
  bytes.push(0);
  f64(398600);
  f64(1.327e11);
  bytes.push(1);
  i32(2);
  for (const time of [0, 1_000_000_000]) {
    f64(time);
    f64(1000);
    f64(0);
    f64(0);
    f64(0);
    f64(1);
    f64(0);
    f64(0);
    f64(0);
  }
  return Uint8Array.from(bytes);
}

test("solar scene loads provider samples through the host proxy", async ({
  page,
}) => {
  const requested: string[] = [];
  const body = Buffer.from(syntheticOrb());
  await page.route("**/api/dynamo/**", async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body,
    });
  });
  await page.goto("/?scene=solar");
  await expect(page.getByTestId("phase")).toHaveText("运行中", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("frames")).not.toHaveText("0", {
    timeout: 60_000,
  });
  await expect(page.getByText("太阳系星历")).toBeVisible();
  expect(
    requested.some((path) => path.endsWith("/earth/sun/orb/def.dyn")),
  ).toBe(true);
  expect(
    requested.some((path) => path.endsWith("/moon/earth/orb/def.dyn")),
  ).toBe(true);
  expect(
    requested.some((path) => path.endsWith("/jupiter/sun/orb/def.dyn")),
  ).toBe(true);
  expect(await page.getByTestId("selection-status").textContent()).toBeTruthy();
});
