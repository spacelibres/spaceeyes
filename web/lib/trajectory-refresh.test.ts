import {test} from "node:test";
import assert from "node:assert/strict";
import {shouldRefreshTrajectory} from "./trajectory-refresh.ts";
test("pending work does not bypass the ordinary expired-path interval", () => {
  assert.equal(shouldRefreshTrajectory(true, false, false, 16, 16), true);
  assert.equal(shouldRefreshTrajectory(false, true, false, 16, 16), false);
  assert.equal(shouldRefreshTrajectory(false, true, false, 49, 49), false);
  assert.equal(shouldRefreshTrajectory(false, true, false, 50, 50), true);
  assert.equal(shouldRefreshTrajectory(false, false, false, 200, 200), false);
});
test("selected refresh follows its own interval despite ordinary or pending updates", () => {
  assert.equal(shouldRefreshTrajectory(false, true, true, 200, 99), false);
  assert.equal(shouldRefreshTrajectory(false, true, true, 10, 100), true);
});
