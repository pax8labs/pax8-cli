// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { getTelemetry, resetTelemetry, accountGroupKey } from "@pax8/core";
import {
  setTelemetryFields,
  consumeTelemetryFields,
  _resetTelemetryFields,
  setActiveCommand,
  consumeActiveCommand,
  _resetActiveCommand,
  resolveTelemetryAccount,
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

  describe("resolveTelemetryAccount (account-group startup seam)", () => {
    const OLD_ID = process.env.PAX8_CLIENT_ID;
    const OLD_SECRET = process.env.PAX8_CLIENT_SECRET;

    const restoreEnv = (key: string, val: string | undefined): void => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };

    beforeEach(() => resetTelemetry());
    afterEach(() => {
      restoreEnv("PAX8_CLIENT_ID", OLD_ID);
      restoreEnv("PAX8_CLIENT_SECRET", OLD_SECRET);
      resetTelemetry();
    });

    function stubbedTelemetry() {
      const t = getTelemetry();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyT = t as any;
      anyT.enabled = true;
      anyT.storageDir = path.join(
        os.tmpdir(),
        `pax8-ctx-acct-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const captures: Array<{ groups?: Record<string, string> }> = [];
      const groupIdentifies: Array<{ groupType: string; groupKey: string }> = [];
      anyT.posthog = {
        capture: (p: { groups?: Record<string, string> }) => captures.push(p),
        groupIdentify: (p: { groupType: string; groupKey: string }) => groupIdentifies.push(p),
        flush: async () => {},
        shutdown: async () => {},
      };
      return { t, captures, groupIdentifies };
    }

    const sigintEvent = {
      event: "command_executed" as const,
      command: "sigint",
      flags: [] as string[],
      duration_ms: 0,
      success: false,
      cancelled: true,
      cli_version: "0.1.0",
      node_version: process.version,
      os: process.platform,
      demo_mode: false,
    };

    it("sets the account group from env credentials so a later track() that never calls setAccount still carries it (SIGINT-path regression)", async () => {
      process.env.PAX8_CLIENT_ID = "partner-under-test";
      process.env.PAX8_CLIENT_SECRET = "secret";

      // Startup seam runs first (as preAction would)…
      await resolveTelemetryAccount();

      // …then an emit path that does NOT call setAccount itself (mirrors the
      // SIGINT handler in signals.ts, which previously shipped null groups).
      const { t, captures, groupIdentifies } = stubbedTelemetry();
      t.track(sigintEvent);
      await t.flush();

      const key = accountGroupKey("partner-under-test");
      expect(groupIdentifies).toEqual([{ groupType: "account", groupKey: key }]);
      expect(captures).toHaveLength(1);
      expect(captures[0].groups).toEqual({ account: key });
    });

    it("resolves to no group when no credentials are configured", async () => {
      delete process.env.PAX8_CLIENT_ID;
      delete process.env.PAX8_CLIENT_SECRET;

      await resolveTelemetryAccount();

      const { t, captures, groupIdentifies } = stubbedTelemetry();
      t.track(sigintEvent);
      await t.flush();

      expect(groupIdentifies).toEqual([]);
      expect(captures).toHaveLength(1);
      expect(captures[0].groups).toBeUndefined();
    });
  });
});
