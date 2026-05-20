// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCli, runCliExpectFailure, runCliExpectSuccess } from "./test-utils.js";

describe("pax8 auth", () => {
  describe("auth login", () => {
    // Subprocess stdout is non-TTY, so per the agent-first default in
    // getOutputFormat() the format resolves to "json" — `auth login` emits
    // a structured envelope (#471). The human banner now lands on stderr.
    it("emits authenticated envelope on stdout in demo mode (non-TTY default)", async () => {
      const result = await runCliExpectSuccess(["auth", "login"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("authenticated");
      expect(parsed.mode).toBe("demo");
    });

    it("shows help text with examples", async () => {
      const result = await runCliExpectSuccess(["auth", "login", "--help"]);
      expect(result.stdout).toContain("client-id");
      expect(result.stdout).toContain("client-secret");
      expect(result.stdout).toContain("Examples:");
    });

    it("accepts credentials via flags (non-interactive path)", async () => {
      // Demo mode short-circuits before validation, but the flag-parsing
      // path still runs — proves the non-interactive contract is intact.
      const result = await runCliExpectSuccess([
        "auth",
        "login",
        "--client-id",
        "test-id",
        "--client-secret",
        "test-secret",
      ]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("authenticated");
    });

    // Regression for #471: human banner ("✓ Authenticated (demo mode)") must
    // not pollute stdout. The agent contract is stdout-is-data; banners are
    // status and belong on stderr. We force table mode via
    // PAX8_OUTPUT_FORMAT=table so the human path is exercised even from a
    // piped subprocess.
    it("routes the success banner to stderr in human mode (#471)", async () => {
      const result = await runCliExpectSuccess(["auth", "login"], {
        PAX8_OUTPUT_FORMAT: "table",
      });
      expect(result.stderr).toContain("Authenticated");
      expect(result.stderr).toContain("demo mode");
      // Stdout in human mode must be empty (no banner, no JSON).
      expect(result.stdout.trim()).toBe("");
    });

    // L-2: drop the `--client-secret <secret>` example from `--help`. Flag
    // values land in shell history; the interactive prompt and the
    // PAX8_CLIENT_SECRET env var are the safe alternatives, so those are
    // what we show.
    //
    // Note: Commander still lists `--client-secret <secret>` in the
    // auto-generated Options block (we keep the flag for CI users). The
    // user-visible regression is the worked Example line that paired
    // `--client-id` with `--client-secret` — that's what must vanish.
    it("does not advertise --client-secret in worked examples (L-2)", async () => {
      const result = await runCliExpectSuccess(["auth", "login", "--help"]);

      // Slice off the Examples section and assert against it specifically,
      // so the flag listing in the auto-generated Options block doesn't
      // false-positive the check.
      const examplesIdx = result.stdout.indexOf("Examples:");
      expect(examplesIdx).toBeGreaterThanOrEqual(0);
      const examples = result.stdout.slice(examplesIdx);

      // No example line should pair `--client-secret` with a literal value.
      expect(examples).not.toContain("--client-secret s3cret");
      // And no example line should invoke `pax8 auth login` with the flag.
      expect(examples).not.toMatch(/pax8 auth login[^\n]*--client-secret/);

      // Affirmatively surface the safer alternatives.
      expect(result.stdout).toContain("PAX8_CLIENT_SECRET");
      expect(result.stdout).toContain("Interactive");
    });

    // L-2: when --client-secret IS passed as a flag, emit a stderr warning
    // pointing the user at the safer alternatives. We still honor the flag
    // (CI users rely on it), so we assert on stderr and that exit is clean.
    it("warns to stderr when --client-secret is passed as a flag (L-2)", async () => {
      const result = await runCliExpectSuccess([
        "auth",
        "login",
        "--client-id",
        "valid-client-id-1234",
        "--client-secret",
        "valid-client-secret-5678",
      ]);
      expect(result.stderr).toContain("--client-secret");
      expect(result.stderr).toContain("shell history");
      expect(result.stderr).toContain("PAX8_CLIENT_SECRET");
    });

    // L-3: client-id format validation. A value with spaces/special chars
    // can never be a valid Pax8 credential — reject it locally rather than
    // wasting a /token round-trip on a 401.
    it("rejects --client-id with invalid characters as ERROR_INVALID_INPUT (L-3)", async () => {
      const result = await runCliExpectFailure(
        [
          "auth",
          "login",
          "--client-id",
          "bad value with spaces",
          "--client-secret",
          "valid-client-secret-1234",
          "--json",
        ],
        { PAX8_DEMO: "" },
      );
      const haystack = result.stderr + result.stdout;
      expect(haystack).toContain("ERROR_INVALID_INPUT");
      expect(haystack).toMatch(/client-id/);
    });

    // L-3: client-secret format validation — same rationale as client-id.
    it("rejects --client-secret with invalid characters as ERROR_INVALID_INPUT (L-3)", async () => {
      const result = await runCliExpectFailure(
        [
          "auth",
          "login",
          "--client-id",
          "valid-client-id-1234",
          "--client-secret",
          "x", // too short — fails the 8-char minimum
          "--json",
        ],
        { PAX8_DEMO: "" },
      );
      const haystack = result.stderr + result.stdout;
      expect(haystack).toContain("ERROR_INVALID_INPUT");
      expect(haystack).toMatch(/client-secret/);
    });

    it("errors cleanly when stdin is non-TTY and no credentials are supplied", async () => {
      // execFile pipes stdin (non-TTY) so the interactive prompt path is skipped.
      // PAX8_DEMO must be off so we hit the credential-check branch.
      const result = await runCli(["auth", "login"], {
        PAX8_DEMO: "",
        PAX8_CLIENT_ID: "",
        PAX8_CLIENT_SECRET: "",
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/Missing credentials|client-id/);
    });
  });

  describe("auth status", () => {
    // Subprocess stdout is non-TTY, so per the agent-first contract (#210)
    // `auth status` auto-emits JSON. We assert on the structured shape and
    // separately verify the human path via the explicit format helpers.
    it("emits JSON in non-TTY (agent-first default)", async () => {
      const result = await runCliExpectSuccess(["auth", "status"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.authenticated).toBe(true);
      expect(parsed.mode).toBe("demo");
    });

    it("emits JSON when --json is passed explicitly", async () => {
      const result = await runCliExpectSuccess(["auth", "status", "--json"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toEqual({ authenticated: true, mode: "demo" });
    });
  });

  describe("auth logout", () => {
    it("succeeds in demo mode", async () => {
      const result = await runCliExpectSuccess(["auth", "logout"]);
      expect(result.stdout).toContain("Logged out");
      expect(result.stdout).toContain("demo mode");
    });
  });

  describe("auth --help", () => {
    it("shows auth subcommands", async () => {
      const result = await runCliExpectSuccess(["auth", "--help"]);
      expect(result.stdout).toContain("login");
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("logout");
    });
  });
});
