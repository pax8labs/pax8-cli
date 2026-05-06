import { describe, it, expect } from "vitest";
import { executeBulk, type BulkOp } from "./bulk-executor.js";

describe("executeBulk", () => {
  it("should execute all operations and collect results", async () => {
    const ops: BulkOp[] = [
      { id: "1", execute: async () => "result-1" },
      { id: "2", execute: async () => "result-2" },
      { id: "3", execute: async () => "result-3" },
    ];

    const result = await executeBulk<string>(ops);
    expect(result.total).toBe(3);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.succeeded.map((s) => s.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("should handle partial failures", async () => {
    const ops: BulkOp[] = [
      { id: "1", execute: async () => "ok" },
      { id: "2", execute: async () => { throw new Error("fail"); } },
      { id: "3", execute: async () => "ok" },
    ];

    const result = await executeBulk<string>(ops);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.failed[0].id).toBe("2");
    expect(result.failed[0].error.message).toBe("fail");
  });

  it("should respect concurrency limits", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeOp = (id: string): BulkOp => ({
      id,
      execute: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        return id;
      },
    });

    const ops = Array.from({ length: 10 }, (_, i) => makeOp(String(i)));
    await executeBulk<string>(ops, { concurrency: 3 });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(1); // Should actually run in parallel
  });

  it("should cap concurrency at 10", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeOp = (id: string): BulkOp => ({
      id,
      execute: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return id;
      },
    });

    const ops = Array.from({ length: 20 }, (_, i) => makeOp(String(i)));
    await executeBulk<string>(ops, { concurrency: 50 });

    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it("should call onProgress after each operation", async () => {
    const progressCalls: Array<{ completed: number; total: number; id: string }> = [];

    const ops: BulkOp[] = [
      { id: "a", execute: async () => "ok" },
      { id: "b", execute: async () => "ok" },
    ];

    await executeBulk<string>(ops, {
      concurrency: 1,
      onProgress: (completed, total, current) => {
        progressCalls.push({ completed, total, id: current.id });
      },
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toEqual({ completed: 1, total: 2, id: "a" });
    expect(progressCalls[1]).toEqual({ completed: 2, total: 2, id: "b" });
  });

  it("should handle empty operations list", async () => {
    const result = await executeBulk<string>([]);
    expect(result.total).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("should handle all operations failing", async () => {
    const ops: BulkOp[] = [
      { id: "1", execute: async () => { throw new Error("e1"); } },
      { id: "2", execute: async () => { throw new Error("e2"); } },
    ];

    const result = await executeBulk<string>(ops);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(2);
    expect(result.total).toBe(2);
  });

  it("should use default concurrency of 5", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeOp = (id: string): BulkOp => ({
      id,
      execute: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent--;
        return id;
      },
    });

    const ops = Array.from({ length: 15 }, (_, i) => makeOp(String(i)));
    await executeBulk<string>(ops);

    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
