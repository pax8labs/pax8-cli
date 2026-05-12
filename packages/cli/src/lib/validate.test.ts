// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError } from "./errors.js";
import {
  validateEnum,
  validateEnumList,
  resolveWithSuggestions,
} from "./validate.js";

describe("validateEnum", () => {
  const ALLOWED = ["Active", "Cancelled", "Trial"] as const;

  it("returns undefined when value is undefined (flag not supplied)", () => {
    expect(validateEnum(undefined, ALLOWED, "--status")).toBeUndefined();
  });

  it("returns the matched value narrowed to the literal type", () => {
    const result = validateEnum("Active", ALLOWED, "--status");
    expect(result).toBe("Active");
  });

  it("throws CliError(ERROR_INVALID_INPUT) for an unknown value", () => {
    try {
      validateEnum("FooBar", ALLOWED, "--status");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cli = err as CliError;
      expect(cli.code).toBe(ERROR_INVALID_INPUT);
      expect(cli.message).toContain(`Invalid value for --status: "FooBar"`);
      // The error message must list the canonical accepted set so the
      // user can self-correct without reading docs.
      expect(cli.causes?.[0]).toContain("Active");
      expect(cli.causes?.[0]).toContain("Cancelled");
    }
  });

  it("is case-sensitive by default (matching API wire behavior)", () => {
    // The Pax8 API rejects `"active"` lowercased on most enum endpoints;
    // fail-fast in the CLI rather than letting it propagate to the API.
    expect(() => validateEnum("active", ALLOWED, "--status")).toThrow(/Invalid/);
  });

  it("with `lowercase: true` matches case-insensitively and returns canonical", () => {
    // Server-side `--status` on quotes/v2 accepts lowercase per #387; the
    // CLI normalizes upper/mixed casing before sending.
    const result = validateEnum("ACTIVE", ALLOWED, "--status", {
      lowercase: true,
    });
    expect(result).toBe("Active");
  });

  it("includes the cmd hint in recovery steps when provided", () => {
    try {
      validateEnum("bogus", ALLOWED, "--status", {
        cmdHint: "pax8 subscriptions list",
      });
      expect.fail("expected throw");
    } catch (err) {
      const cli = err as CliError;
      expect(cli.recoverySteps?.[0]).toContain("pax8 subscriptions list");
    }
  });
});

describe("validateEnumList", () => {
  const ALLOWED = ["Admin", "Billing", "Technical"] as const;

  it("returns undefined when value is undefined", () => {
    expect(validateEnumList(undefined, ALLOWED, "--type")).toBeUndefined();
  });

  it("parses a single value", () => {
    expect(validateEnumList("Admin", ALLOWED, "--type")).toEqual(["Admin"]);
  });

  it("parses comma-separated values and deduplicates", () => {
    expect(validateEnumList("Admin,Billing,Admin", ALLOWED, "--type")).toEqual([
      "Admin",
      "Billing",
    ]);
  });

  it("trims whitespace around each token", () => {
    expect(validateEnumList(" Admin , Billing ", ALLOWED, "--type")).toEqual([
      "Admin",
      "Billing",
    ]);
  });

  it("throws when all input is whitespace / empty", () => {
    try {
      validateEnumList(" , , ", ALLOWED, "--type");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe(ERROR_INVALID_INPUT);
      expect((err as CliError).message).toContain(
        "At least one value is required",
      );
    }
  });

  it("throws and lists invalid tokens individually", () => {
    try {
      validateEnumList("Admin,WrongRole,AlsoBad", ALLOWED, "--type");
      expect.fail("expected throw");
    } catch (err) {
      const cli = err as CliError;
      expect(cli.code).toBe(ERROR_INVALID_INPUT);
      expect(cli.message).toContain(`"WrongRole"`);
      expect(cli.message).toContain(`"AlsoBad"`);
      expect(cli.causes?.[0]).toContain("Admin");
    }
  });
});

describe("resolveWithSuggestions", () => {
  it("returns the result when exactMatch resolves a value", async () => {
    const value = { id: "prod-1", name: "Match" };
    const result = await resolveWithSuggestions(
      "Match",
      async () => value,
      async () => [],
      "Product",
    );
    expect(result).toEqual(value);
  });

  it("throws with 'Did you mean' when exact match misses and search returns hits", async () => {
    try {
      await resolveWithSuggestions<{ id: string }>(
        "Microsoft 365",
        async () => null,
        async () => [
          { id: "prod-m365-biz-prem-0001", name: "Microsoft 365 Business Premium [NCE]" },
          { id: "prod-m365-e3-0003", name: "Microsoft 365 E3" },
          { id: "prod-m365-e5-0004", name: "Microsoft 365 E5" },
        ],
        "Product",
        { searchCmd: "pax8 products search" },
      );
      expect.fail("expected throw");
    } catch (err) {
      const cli = err as CliError;
      expect(cli).toBeInstanceOf(CliError);
      expect(cli.code).toBe(ERROR_INVALID_INPUT);
      expect(cli.message).toBe(`Product "Microsoft 365" not found`);
      // Suggestions appear in recovery steps
      const recovery = cli.recoverySteps?.join("\n") ?? "";
      expect(recovery).toContain("Did you mean");
      expect(recovery).toContain("Microsoft 365 Business Premium [NCE]");
      expect(recovery).toContain("prod-m365-biz-prem-0001");
      expect(recovery).toContain("pax8 products search");
    }
  });

  it("caps suggestions at top-3 by default", async () => {
    try {
      await resolveWithSuggestions<{ id: string }>(
        "q",
        async () => null,
        async () => [
          { id: "1", name: "One" },
          { id: "2", name: "Two" },
          { id: "3", name: "Three" },
          { id: "4", name: "Four" },
          { id: "5", name: "Five" },
        ],
        "Product",
      );
      expect.fail("expected throw");
    } catch (err) {
      const recovery = (err as CliError).recoverySteps?.join("\n") ?? "";
      expect(recovery).toContain("One");
      expect(recovery).toContain("Two");
      expect(recovery).toContain("Three");
      expect(recovery).not.toContain("Four");
      expect(recovery).not.toContain("Five");
    }
  });

  it("emits '(no close matches found)' style hint when search returns empty", async () => {
    try {
      await resolveWithSuggestions<{ id: string }>(
        "totally-bogus",
        async () => null,
        async () => [],
        "Product",
      );
      expect.fail("expected throw");
    } catch (err) {
      const recovery = (err as CliError).recoverySteps?.join("\n") ?? "";
      expect(recovery.toLowerCase()).toContain("no close matches");
    }
  });

  it("survives a thrown search call (best-effort) and still emits a useful not-found", async () => {
    try {
      await resolveWithSuggestions<{ id: string }>(
        "x",
        async () => null,
        async () => {
          throw new Error("transient API failure");
        },
        "Product",
      );
      expect.fail("expected throw");
    } catch (err) {
      const cli = err as CliError;
      expect(cli.code).toBe(ERROR_INVALID_INPUT);
      expect(cli.message).toContain("not found");
    }
  });
});
