import { describe, it, expect, vi, afterEach } from "vitest";
import { invalidateCacheAfterWrite } from "./invalidate-cache.js";

describe("invalidateCacheAfterWrite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls FileCache.clear() to wipe cached entries", async () => {
    const core = await import("@pax8/core");
    const clearSpy = vi
      .spyOn(core.FileCache.prototype, "clear")
      .mockResolvedValue();

    await invalidateCacheAfterWrite();

    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("swallows errors thrown by FileCache.clear()", async () => {
    const core = await import("@pax8/core");
    vi.spyOn(core.FileCache.prototype, "clear").mockRejectedValueOnce(
      new Error("disk full")
    );

    // Must not reject — we don't want a write command to fail just because
    // the post-write cache wipe couldn't run.
    await expect(invalidateCacheAfterWrite()).resolves.toBeUndefined();
  });

  it("does not propagate sync errors to callers", async () => {
    // Even if `clear()` throws synchronously instead of rejecting, the
    // wrapper must still resolve cleanly — callers rely on this contract.
    const core = await import("@pax8/core");
    vi.spyOn(core.FileCache.prototype, "clear").mockImplementationOnce(() => {
      throw new Error("sync boom");
    });

    await expect(invalidateCacheAfterWrite()).resolves.toBeUndefined();
  });
});
