// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach } from "vitest";
import {
  setTelemetryFields,
  consumeTelemetryFields,
  _resetTelemetryFields,
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
    setTelemetryFields({ a: 1 });
    const first = consumeTelemetryFields();
    setTelemetryFields({ b: 2 });
    const second = consumeTelemetryFields();
    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ b: 2 });
  });
});
