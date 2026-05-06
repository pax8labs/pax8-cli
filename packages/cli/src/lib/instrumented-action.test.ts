import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyError, instrumentedAction } from "./instrumented-action.js";
import { CliError } from "./errors.js";
import {
  AuthError,
  RateLimitError,
  ValidationError,
  ApiError,
  ERROR_AUTH_EXPIRED,
  ERROR_RATE_LIMITED,
  ERROR_API_VALIDATION,
  ERROR_API_TIMEOUT,
  ERROR_NOT_AUTHORIZED,
  ERROR_NOT_FOUND,
  ERROR_INTERNAL,
  ERROR_COMPANY_NOT_FOUND,
} from "@pax8/core";

describe("classifyError", () => {
  it("classifies AuthError as ERROR_AUTH_EXPIRED", () => {
    expect(classifyError(new AuthError("fail"))).toBe(ERROR_AUTH_EXPIRED);
  });

  it("classifies RateLimitError as ERROR_RATE_LIMITED", () => {
    expect(classifyError(new RateLimitError("rate", "/test", 1000))).toBe(ERROR_RATE_LIMITED);
  });

  it("classifies ValidationError as ERROR_API_VALIDATION", () => {
    expect(classifyError(new ValidationError("invalid"))).toBe(ERROR_API_VALIDATION);
  });

  it("classifies ApiError with 404 as ERROR_NOT_FOUND", () => {
    expect(classifyError(new ApiError("not found", 404, "/test"))).toBe(ERROR_NOT_FOUND);
  });

  it("classifies ApiError with 401 as ERROR_AUTH_EXPIRED", () => {
    expect(classifyError(new ApiError("unauthorized", 401, "/test"))).toBe(ERROR_AUTH_EXPIRED);
  });

  it("classifies ApiError with 408 as ERROR_API_TIMEOUT", () => {
    expect(classifyError(new ApiError("timeout", 408, "/test"))).toBe(ERROR_API_TIMEOUT);
  });

  it("classifies ApiError with 429 as ERROR_RATE_LIMITED", () => {
    expect(classifyError(new ApiError("rate", 429, "/test"))).toBe(ERROR_RATE_LIMITED);
  });

  it("classifies ApiError with 5xx as ERROR_INTERNAL", () => {
    expect(classifyError(new ApiError("server error", 500, "/test"))).toBe(ERROR_INTERNAL);
  });

  it("prefers CliError.code when present", () => {
    const err = new CliError("missing", undefined, undefined, undefined, ERROR_COMPANY_NOT_FOUND);
    expect(classifyError(err)).toBe(ERROR_COMPANY_NOT_FOUND);
  });

  it("classifies network errors as ERROR_API_TIMEOUT", () => {
    expect(classifyError(new Error("ECONNREFUSED"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("ENOTFOUND"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("ETIMEDOUT"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("fetch failed"))).toBe(ERROR_API_TIMEOUT);
    expect(classifyError(new Error("network error occurred"))).toBe(ERROR_API_TIMEOUT);
  });

  it("classifies unknown errors as ERROR_INTERNAL", () => {
    expect(classifyError(new Error("something else"))).toBe(ERROR_INTERNAL);
    expect(classifyError("string error")).toBe(ERROR_INTERNAL);
    expect(classifyError(null)).toBe(ERROR_INTERNAL);
    expect(classifyError(undefined)).toBe(ERROR_INTERNAL);
  });

  it("returns values that match the ERROR_* vocabulary", () => {
    const allowed = new Set([
      ERROR_AUTH_EXPIRED,
      ERROR_RATE_LIMITED,
      ERROR_API_VALIDATION,
      ERROR_API_TIMEOUT,
      ERROR_NOT_AUTHORIZED,
      ERROR_NOT_FOUND,
      ERROR_INTERNAL,
      ERROR_COMPANY_NOT_FOUND,
    ]);
    const samples: unknown[] = [
      new AuthError("x"),
      new RateLimitError("x", "/p", 1),
      new ValidationError("x"),
      new ApiError("x", 404, "/p"),
      new ApiError("x", 500, "/p"),
      new Error("ECONNREFUSED"),
      new Error("anything"),
      "raw string",
      null,
    ];
    for (const s of samples) {
      const code = classifyError(s);
      expect(allowed.has(code)).toBe(true);
      expect(code).toMatch(/^ERROR_[A-Z_]+$/);
    }
  });
});

describe("instrumentedAction", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PAX8_DEMO;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("calls the wrapped action", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const wrapped = instrumentedAction("test.command", action);

    await wrapped({ json: true, verbose: false });

    expect(action).toHaveBeenCalledWith({ json: true, verbose: false });
  });

  it("re-throws errors from the action", async () => {
    const error = new Error("test error");
    const action = vi.fn().mockRejectedValue(error);
    const wrapped = instrumentedAction("test.command", action);

    await expect(wrapped({})).rejects.toThrow("test error");
  });
});

/**
 * #146 — write commands (recommendations act, orders create) used to fire two
 * `command_executed` events: one from the `postAction` hook in index.ts, and
 * one manually inside the handler to attach aggregate counters. These tests
 * pin the new invariant: handlers contribute via `setTelemetryFields()`, the
 * postAction hook merges those fields into its single canonical track call.
 *
 * We don't run the whole Commander program here — we exercise the merge
 * contract directly. The integration is small enough that a unit test is
 * the right grain.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- accessing private members for testing */
describe("postAction telemetry merge (#146)", () => {
  beforeEach(async () => {
    const { resetTelemetry } = await import("@pax8/core");
    resetTelemetry();
  });

  afterEach(async () => {
    const { _resetTelemetryFields } = await import("./telemetry-context.js");
    _resetTelemetryFields();
  });

  it("merges setTelemetryFields contributions into a single command_executed event", async () => {
    const { setTelemetryFields, consumeTelemetryFields } = await import(
      "./telemetry-context.js"
    );
    const { getTelemetry } = await import("@pax8/core");

    // Simulate a `recommendations act` handler contributing fields.
    setTelemetryFields({
      recs_presented: 3,
      recs_ordered: 2,
      recs_skipped: 1,
      recs_mrr_captured: 250,
    });

    // Mimic exactly what the postAction hook does: drain + merge into the
    // intrinsic event shape and emit ONE track() call.
    const telemetry = getTelemetry();
    (telemetry as any).enabled = true;

    const handlerProps = consumeTelemetryFields();
    const intrinsic = {
      event: "command_executed" as const,
      command: "recommendations",
      subcommand: "recommendations.act",
      flags: ["--priority"],
      duration_ms: 42,
      success: true,
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
    };
    telemetry.track({ ...intrinsic, ...handlerProps });

    const buffer = (telemetry as any).buffer as unknown[];
    expect(buffer).toHaveLength(1);
    const evt = buffer[0] as Record<string, unknown>;
    // command/subcommand match the README #134 contract: top-level group +
    // dotted path. No more `command: "recommendations.act"` from the manual
    // track() call.
    expect(evt.command).toBe("recommendations");
    expect(evt.subcommand).toBe("recommendations.act");
    // Aggregate counters come along on the same event.
    expect(evt.recs_presented).toBe(3);
    expect(evt.recs_ordered).toBe(2);
    expect(evt.recs_skipped).toBe(1);
    expect(evt.recs_mrr_captured).toBe(250);
    // And the intrinsic props are still present.
    expect(evt.success).toBe(true);
    expect(evt.duration_ms).toBe(42);
  });

  it("merges orders.create revenue counters into a single event", async () => {
    const { setTelemetryFields, consumeTelemetryFields } = await import(
      "./telemetry-context.js"
    );
    const { getTelemetry } = await import("@pax8/core");

    setTelemetryFields({
      order_success: true,
      order_total_dollars: 500,
      order_mrr_impact: 50,
      order_seats: 10,
    });

    const telemetry = getTelemetry();
    (telemetry as any).enabled = true;

    const handlerProps = consumeTelemetryFields();
    telemetry.track({
      event: "command_executed",
      command: "orders",
      subcommand: "orders.create",
      flags: [],
      duration_ms: 100,
      success: true,
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
      ...handlerProps,
    });

    const buffer = (telemetry as any).buffer as unknown[];
    expect(buffer).toHaveLength(1);
    const evt = buffer[0] as Record<string, unknown>;
    expect(evt.command).toBe("orders");
    expect(evt.subcommand).toBe("orders.create");
    expect(evt.order_success).toBe(true);
    expect(evt.order_total_dollars).toBe(500);
    expect(evt.order_mrr_impact).toBe(50);
    expect(evt.order_seats).toBe(10);
  });

  it("a regular read-only command with no setTelemetryFields fires exactly one event with no extra props", async () => {
    const { consumeTelemetryFields } = await import("./telemetry-context.js");
    const { getTelemetry } = await import("@pax8/core");

    const telemetry = getTelemetry();
    (telemetry as any).enabled = true;

    const handlerProps = consumeTelemetryFields(); // empty
    telemetry.track({
      event: "command_executed",
      command: "companies",
      subcommand: "companies.list",
      flags: ["--json"],
      duration_ms: 25,
      success: true,
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
      ...handlerProps,
    });

    const buffer = (telemetry as any).buffer as unknown[];
    expect(buffer).toHaveLength(1);
    const evt = buffer[0] as Record<string, unknown>;
    expect(evt.command).toBe("companies");
    expect(evt.subcommand).toBe("companies.list");
    expect(evt.recs_presented).toBeUndefined();
    expect(evt.order_seats).toBeUndefined();
  });

  it("a leftover handlerProp from one consume does NOT leak to the next event", async () => {
    const { setTelemetryFields, consumeTelemetryFields } = await import(
      "./telemetry-context.js"
    );

    setTelemetryFields({ recs_presented: 5 });
    const first = consumeTelemetryFields();
    const second = consumeTelemetryFields();

    expect(first).toEqual({ recs_presented: 5 });
    expect(second).toEqual({});
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
