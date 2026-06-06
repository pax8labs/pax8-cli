// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import {
  setTelemetryFields,
  consumeTelemetryFields,
  _resetTelemetryFields,
  setActiveCommand,
  consumeActiveCommand,
  _resetActiveCommand,
} from "./telemetry-context.js";

describe("telemetry-context", () => {
  beforeEach(() => {
    _resetTelemetryFields();
  });

  it("returns an empty object when nothing has been set", () => {
    expect(consumeTelemetryFields()).toEqual({});
  });

  it("captures fields contributed by a handler", () => {
    setTelemetryFields({ recs_presented: 7, recs_ordered: 2 });
    expect(consumeTelemetryFields()).toEqual({
      recs_presented: 7,
      recs_ordered: 2,
    });
  });

  it("merges across multiple setTelemetryFields calls (later wins on collision)", () => {
    setTelemetryFields({ order_seats: 1 });
    setTelemetryFields({ order_seats: 5, order_total_dollars: 100 });
    expect(consumeTelemetryFields()).toEqual({
      order_seats: 5,
      order_total_dollars: 100,
    });
  });

  it("drops undefined values so callers can pass optional values through", () => {
    setTelemetryFields({ order_mrr_impact: undefined, order_seats: 3 });
    expect(consumeTelemetryFields()).toEqual({ order_seats: 3 });
  });

  it("consume drains state — a second consume returns an empty object", () => {
    setTelemetryFields({ recs_mrr_captured: 42 });
    expect(consumeTelemetryFields()).toEqual({ recs_mrr_captured: 42 });
    expect(consumeTelemetryFields()).toEqual({});
  });

  it("consume returns a fresh object the caller owns", () => {
    setTelemetryFields({ recs_presented: 1 });
    const first = consumeTelemetryFields();
    setTelemetryFields({ order_seats: 2 });
    const second = consumeTelemetryFields();
    expect(first).toEqual({ recs_presented: 1 });
    expect(second).toEqual({ order_seats: 2 });
  });

  describe("active command context (failure-event attribution)", () => {
    beforeEach(() => {
      _resetActiveCommand();
    });

    it("consume returns null when no command is active", () => {
      expect(consumeActiveCommand()).toBeNull();
    });

    it("set and consume return the stashed context", () => {
      setActiveCommand({
        command: "invoices",
        subcommand: "invoices.audit",
        flags: ["--month", "--json"],
        startTime: 1000,
      });
      expect(consumeActiveCommand()).toEqual({
        command: "invoices",
        subcommand: "invoices.audit",
        flags: ["--month", "--json"],
        startTime: 1000,
      });
    });

    it("consume clears state — a second consume returns null", () => {
      setActiveCommand({
        command: "dashboard",
        subcommand: "dashboard",
        flags: [],
        startTime: 0,
      });
      expect(consumeActiveCommand()).not.toBeNull();
      expect(consumeActiveCommand()).toBeNull();
    });

    it("set replaces any earlier active command (no accumulation)", () => {
      setActiveCommand({ command: "a", subcommand: "a", flags: [], startTime: 0 });
      setActiveCommand({ command: "b", subcommand: "b", flags: [], startTime: 0 });
      expect(consumeActiveCommand()?.command).toBe("b");
    });
  });
});
