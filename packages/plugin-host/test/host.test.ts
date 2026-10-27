// SPDX-License-Identifier: MIT
// Copyright (c) 2026 SPACEEYES contributors

import assert from "node:assert/strict";
import test from "node:test";

import {
  DYNAMO_ORIGIN,
  PluginHost,
  PluginHostError,
  PluginManifestError,
  PluginPolicyError,
  authorize,
  createDynamoPlugin,
  validateManifest,
  type PluginContext,
  type PluginTransport,
} from "../src/index.js";

const manifest = {
  id: "test.plugin",
  version: "0.0.1",
  kind: "data-source",
  capabilities: ["read"],
  permissions: { network: { hosts: ["https://example.com"] } },
  limits: { maxFetchBytes: 8 },
};
const policy = {
  allowedCapabilities: ["read"],
  allowedNetworkHosts: ["https://example.com"],
  maxFetchBytes: 64,
};

class FakeTransport implements PluginTransport {
  readonly calls: string[] = [];
  bytes: Uint8Array = new Uint8Array([1, 2, 3]);
  async request(
    origin: string,
    path: string,
    _signal: AbortSignal,
  ): Promise<Uint8Array> {
    this.calls.push(`${origin}/${path}`);
    return this.bytes;
  }
}

function pluginContextCapture(): {
  context: () => PluginContext | undefined;
  factory: () => { start(): Promise<void>; stop(): Promise<void> };
} {
  let captured: PluginContext | undefined;
  return {
    context: () => captured,
    factory: () => ({ start: async () => {}, stop: async () => {} }),
  };
}

test("manifest validation rejects malformed identities and limits", () => {
  assert.throws(
    () => validateManifest({ ...manifest, id: "Bad ID" }),
    PluginManifestError,
  );
  assert.throws(
    () => validateManifest({ ...manifest, version: "1.0" }),
    PluginManifestError,
  );
  assert.throws(
    () => validateManifest({ ...manifest, kind: "renderer" }),
    PluginManifestError,
  );
  assert.throws(
    () => validateManifest({ ...manifest, capabilities: ["read", "read"] }),
    PluginManifestError,
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        permissions: { network: { hosts: ["http://example.com"] } },
      }),
    PluginManifestError,
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        permissions: { network: { hosts: ["https://example.com/path"] } },
      }),
    PluginManifestError,
  );
  assert.throws(
    () => validateManifest({ ...manifest, limits: { maxFetchBytes: 0 } }),
    PluginManifestError,
  );
  assert.equal(
    validateManifest(manifest).permissions.network.hosts[0],
    "https://example.com",
  );
});

test("authorization requires subset capabilities and hosts and clamps limits", () => {
  assert.throws(
    () =>
      authorize(
        validateManifest({ ...manifest, capabilities: ["write"] }),
        policy,
      ),
    PluginPolicyError,
  );
  assert.throws(
    () =>
      authorize(
        validateManifest({
          ...manifest,
          permissions: { network: { hosts: ["https://other.example"] } },
        }),
        policy,
      ),
    PluginPolicyError,
  );
  const grant = authorize(validateManifest(manifest), policy);
  assert.equal(grant.maxFetchBytes, 8);
});

test("host enforces installation, lifecycle and granted hosts", async () => {
  const transport = new FakeTransport();
  const host = new PluginHost(policy, transport);
  host.install(manifest, (_context) => pluginContextCapture().factory());
  assert.throws(
    () => host.install(manifest, () => pluginContextCapture().factory()),
    (error) => {
      assert.ok(error instanceof PluginHostError);
      assert.equal(error.code, "duplicate");
      return true;
    },
  );
  assert.throws(() => host.isEnabled("missing"), PluginHostError);
  await host.enable(manifest.id);
  assert.equal(host.isEnabled(manifest.id), true);
  await host.enable(manifest.id);
  assert.equal(host.isEnabled(manifest.id), true);
  await host.disable(manifest.id);
  assert.equal(host.isEnabled(manifest.id), false);
});

test("context rejects unlisted hosts, traversal and oversized responses", async () => {
  let captured: PluginContext | undefined;
  const transport = new FakeTransport();
  const host = new PluginHost(policy, transport);
  host.install(manifest, (context) => {
    captured = context;
    return { start: async () => {}, stop: async () => {} };
  });
  await host.enable(manifest.id);
  const context = captured;
  assert.ok(context !== undefined);
  await assert.rejects(
    context.request("https://eyes.nasa.gov", "a"),
    (error) => {
      assert.ok(error instanceof PluginHostError);
      assert.equal(error.code, "denied");
      return true;
    },
  );
  for (const path of ["../a", "/a", "a//b", "a?b", "a\\b", ""]) {
    await assert.rejects(
      context.request("https://example.com", path),
      (error) => {
        assert.ok(error instanceof PluginHostError);
        assert.equal(error.code, "denied");
        return true;
      },
    );
  }
  transport.bytes = new Uint8Array(9);
  await assert.rejects(
    context.request("https://example.com", "asset"),
    (error) => {
      assert.ok(error instanceof PluginHostError);
      assert.equal(error.code, "limit");
      return true;
    },
  );
  transport.bytes = new Uint8Array([7]);
  assert.deepEqual(
    await context.request("https://example.com", "asset"),
    new Uint8Array([7]),
  );
  await host.disable(manifest.id);
  await assert.rejects(
    context.request("https://example.com", "asset"),
    (error) => {
      assert.ok(error instanceof PluginHostError);
      assert.equal(error.code, "aborted");
      return true;
    },
  );
});

test("disable aborts an in-flight request", async () => {
  let captured: PluginContext | undefined;
  const transport: PluginTransport = {
    request: (_origin, _path, signal) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      }),
  };
  const host = new PluginHost(policy, transport);
  host.install(manifest, (context) => {
    captured = context;
    return { start: async () => {}, stop: async () => {} };
  });
  await host.enable(manifest.id);
  const pending = captured!.request("https://example.com", "asset");
  await host.disable(manifest.id);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof PluginHostError);
    assert.equal(error.code, "aborted");
    return true;
  });
});

test("revocation denies re-enable and start failures roll back", async () => {
  const host = new PluginHost(policy, new FakeTransport());
  host.install(manifest, () => ({
    start: async () => {},
    stop: async () => {},
  }));
  await host.revoke(manifest.id);
  await assert.rejects(host.enable(manifest.id), (error) => {
    assert.ok(error instanceof PluginHostError);
    assert.equal(error.code, "denied");
    return true;
  });
  const failing = { ...manifest, id: "test.failing" };
  host.install(failing, () => ({
    start: async () => {
      throw new Error("boom");
    },
    stop: async () => {},
  }));
  await assert.rejects(host.enable(failing.id), (error) => {
    assert.ok(error instanceof PluginHostError);
    assert.equal(error.code, "state");
    return true;
  });
  assert.equal(host.isEnabled(failing.id), false);
});

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
  f64(1);
  f64(1);
  bytes.push(1);
  i32(2);
  for (const time of [0, 1_000_000_000]) {
    f64(time);
    f64(1000);
    f64(0);
    f64(1e-7);
    f64(0);
    f64(1);
    f64(0);
    f64(0);
    f64(0);
  }
  return Uint8Array.from(bytes);
}

test("DYN plugin loads through the granted host context", async () => {
  const transport = new FakeTransport();
  transport.bytes = syntheticOrb();
  const dynamo = createDynamoPlugin();
  const host = new PluginHost(
    {
      allowedCapabilities: [...dynamo.manifest.capabilities],
      allowedNetworkHosts: [DYNAMO_ORIGIN],
      maxFetchBytes: 1024 * 1024,
    },
    transport,
  );
  host.install(dynamo.manifest, dynamo.factory);
  await host.enable(dynamo.manifest.id);
  const loader = dynamo.loader();
  assert.ok(loader !== undefined);
  const loaded = await loader.load("earth/sun/orb/def.dyn", 0);
  assert.equal(loaded.points.length, 2);
  assert.deepEqual(transport.calls, [`${DYNAMO_ORIGIN}/earth/sun/orb/def.dyn`]);
  await host.disable(dynamo.manifest.id);
  assert.equal(dynamo.loader(), undefined);
});

test("manifest contributions are bounded, unique, and namespaced", () => {
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        contributions: [{ id: "panel", kind: "panel", title: "" }],
      }),
    PluginManifestError,
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        contributions: [
          { id: "panel", kind: "panel", title: "A" },
          { id: "panel", kind: "layer", title: "B" },
        ],
      }),
    PluginManifestError,
  );
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        contributions: [{ id: "panel", kind: "window", title: "A" }],
      }),
    PluginManifestError,
  );
  const validated = validateManifest({
    ...manifest,
    contributions: [{ id: "panel", kind: "panel", title: "Ephemeris" }],
  });
  assert.deepEqual(validated.contributions, [
    { id: "panel", kind: "panel", title: "Ephemeris" },
  ]);
});

test("active contributions follow enable, disable, and revoke", async () => {
  const host = new PluginHost(policy, new FakeTransport());
  const installed = host.install(
    {
      ...manifest,
      contributions: [
        { id: "ephemeris-panel", kind: "panel", title: "Ephemeris" },
        { id: "orbit-layer", kind: "layer", title: "Orbit layer" },
      ],
    },
    pluginContextCapture().factory,
  );
  assert.deepEqual(host.activeContributions(), []);
  await host.enable(installed.id);
  assert.deepEqual(
    host.activeContributions().map((item) => `${item.id}:${item.kind}`),
    ["test.plugin:ephemeris-panel:panel", "test.plugin:orbit-layer:layer"],
  );
  await host.disable(installed.id);
  assert.deepEqual(host.activeContributions(), []);
  await host.enable(installed.id);
  await host.revoke(installed.id);
  assert.deepEqual(host.activeContributions(), []);
});

test("permission expansion requires a stopped plugin and never escapes policy", async () => {
  const expandedPolicy = {
    allowedCapabilities: ["read", "write"],
    allowedNetworkHosts: ["https://example.com", "https://data.example.com"],
    maxFetchBytes: 64,
  };
  const host = new PluginHost(expandedPolicy, new FakeTransport());
  const installed = host.install(manifest, pluginContextCapture().factory);
  await host.enable(installed.id);
  assert.throws(
    () =>
      host.expandGrant(
        installed.id,
        ["read", "write"],
        ["https://example.com"],
      ),
    PluginHostError,
  );
  await host.disable(installed.id);
  // Removing an existing capability is not an expansion.
  assert.throws(
    () => host.expandGrant(installed.id, ["write"], ["https://example.com"]),
    PluginPolicyError,
  );
  assert.throws(
    () =>
      host.expandGrant(
        installed.id,
        ["read", "teleport"],
        ["https://example.com"],
      ),
    PluginPolicyError,
  );
  assert.throws(
    () =>
      host.expandGrant(installed.id, ["read"], ["https://evil.example.com"]),
    PluginPolicyError,
  );
  assert.deepEqual(host.grant(installed.id), {
    capabilities: ["read"],
    hosts: ["https://example.com"],
    maxFetchBytes: 8,
  });
  const grant = host.expandGrant(
    installed.id,
    ["read", "write"],
    ["https://example.com", "https://data.example.com"],
  );
  assert.deepEqual(grant, {
    capabilities: ["read", "write"],
    hosts: ["https://example.com", "https://data.example.com"],
    maxFetchBytes: 8,
  });
  await host.enable(installed.id);
  await host.revoke(installed.id);
  assert.throws(
    () => host.expandGrant(installed.id, ["read"], ["https://example.com"]),
    PluginHostError,
  );
});
