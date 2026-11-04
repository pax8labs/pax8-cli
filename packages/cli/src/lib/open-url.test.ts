// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { openUrl, resolveOpener, type Spawner } from "./open-url.js";

/**
 * Build a fake child-process emitter that satisfies the subset of
 * ChildProcess our `Spawner` shape requires. Optionally fires `error` on
 * next tick so we can exercise the failure branch.
 */
function fakeChild(opts: { failWith?: Error } = {}) {
  const ee = new EventEmitter() as EventEmitter & { unref: () => void };
  ee.unref = () => {};
  if (opts.failWith) {
    process.nextTick(() => ee.emit("error", opts.failWith));
  }
  return ee;
}

describe("resolveOpener", () => {
  it("returns `open` + [url] on darwin", () => {
    const r = resolveOpener("darwin");
    expect(r.cmd).toBe("open");
    expect(r.args("https://example.com")).toEqual(["https://example.com"]);
  });

  it("returns `cmd /c start \"\" <url>` on win32 (handles URL-special chars)", () => {
    const r = resolveOpener("win32");
    expect(r.cmd).toBe("cmd");
    expect(r.args("https://example.com?a=1&b=2")).toEqual([
      "/c",
      "start",
      "",
      "https://example.com?a=1&b=2",
    ]);
  });

  it("returns `xdg-open` + [url] on linux / other", () => {
    const r = resolveOpener("linux");
    expect(r.cmd).toBe("xdg-open");
    expect(r.args("https://example.com")).toEqual(["https://example.com"]);
  });
});

describe("openUrl", () => {
  it("invokes the platform opener with the URL and resolves true", async () => {
    const spawner = vi.fn<Spawner>().mockReturnValue(fakeChild());
    const ok = await openUrl("https://example.com/x", {
      spawner,
      platform: "darwin",
      logPath: null,
    });
    expect(ok).toBe(true);
    expect(spawner).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawner.mock.calls[0];
    expect(cmd).toBe("open");
    expect(args).toEqual(["https://example.com/x"]);
  });

  it("resolves false when the spawner emits an error (no opener / headless)", async () => {
    const spawner = vi
      .fn<Spawner>()
      .mockReturnValue(fakeChild({ failWith: new Error("ENOENT") }));
    const ok = await openUrl("https://example.com/y", {
      spawner,
      platform: "linux",
      logPath: null,
    });
    expect(ok).toBe(false);
  });

  it("resolves false when the spawner throws synchronously", async () => {
    const spawner = vi.fn<Spawner>().mockImplementation(() => {
      throw new Error("spawn EACCES");
    });
    const ok = await openUrl("https://example.com/z", {
      spawner,
      platform: "linux",
      logPath: null,
    });
    expect(ok).toBe(false);
  });

  it("never throws even when the spawner is broken", async () => {
    const spawner = vi.fn<Spawner>().mockImplementation(() => {
      throw new Error("boom");
    });
    await expect(
      openUrl("https://example.com", { spawner, platform: "linux", logPath: null }),
    ).resolves.toBe(false);
  });
});
