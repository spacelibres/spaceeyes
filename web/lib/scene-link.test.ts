import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSceneLink, formatSceneLink } from "./scene-link.ts";
const ids = ["earth", "moon", "craft/path"];
test("scene links default and roundtrip semantic state", () => {
  assert.equal(parseSceneLink("", ids), undefined);
  const home = parseSceneLink("#/home", ids)!;
  assert.equal(home.targetId, "");
  assert.equal(home.rate, 1);
  assert.equal(home.playing, true);
  assert.equal(home.fovDegrees, 45);
  const state = {
    ...home,
    targetId: "earth",
    epoch: -100,
    rate: -60,
    playing: false,
    mode: "follow" as const,
    followId: "moon",
    view: "top" as const,
    lighting: "flood" as const,
    labels: false,
    spacecraft: false,
  };
  assert.deepEqual(parseSceneLink(formatSceneLink(state, ids), ids), state);
  assert.equal(parseSceneLink("#/craft%2Fpath", ids)?.targetId, "craft/path");
});
test("scene links reject malformed unknown duplicate and inconsistent values", () => {
  for (const hash of [
    "#",
    "earth",
    "#/unknown",
    "#/earth?x=1",
    "#/earth?rate=1&rate=2",
    "#/earth?tdb=NaN",
    "#/earth?tdb=1000000000001",
    "#/earth?rate=0",
    "#/earth?rate=94608001",
    "#/earth?play=true",
    "#/earth?fov=9",
    "#/earth?mode=follow",
    "#/earth?mode=follow&follow=earth",
    "#/earth?follow=moon",
    "#/home?mode=system",
    "#/home?mode=follow&follow=moon",
    "#/earth?labels=2",
    "#/earth?tdb=",
    "#/earth?tdb=0x10",
    "#/%ZZ",
    "#/earth?" + "a".repeat(4096),
  ])
    assert.throws(() => parseSceneLink(hash, ids), hash);
});
