// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli, runCliExpectSuccess } from "./test-utils.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

describe("pax8 telemetry", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-telemetry-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("telemetry --help", () => {
    it("shows telemetry subcommands", async () => {
      const result = await runCliExpectSuccess(["telemetry", "--help"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("status");
      expect(result.stdout).toContain("enable");
      expect(result.stdout).toContain("disable");
    });
  });

  describe("telemetry status", () => {
    it("reports telemetry status", async () => {
      const result = await runCliExpectSuccess(["telemetry", "status"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      // Should say either enabled or disabled
      expect(result.stdout).toMatch(/Telemetry is (enabled|disabled)/);
    });
  });

  describe("telemetry enable", () => {
    it("enables telemetry", async () => {
      // First ensure config exists
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "enable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry enabled");
    });
  });

  describe("telemetry disable", () => {
    it("disables telemetry", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "disable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });

  describe("telemetry status after toggle", () => {
    it("enable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "enable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry enabled");
    });

    it("disable command reports success", async () => {
      await runCliExpectSuccess(["config", "init", "--force"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      const result = await runCliExpectSuccess(["telemetry", "disable"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.stdout).toContain("Telemetry disabled");
    });
  });

  describe("failure-event emission (#145)", () => {
    // Reads the JSONL backup written by `flush()` so tests don't depend on
    // a live PostHog network call.
    const readEvents = async (
      dir: string,
    ): Promise<Array<Record<string, unknown>>> => {
      const today = new Date().toISOString().slice(0, 10);
      const jsonl = path.join(dir, "telemetry", `${today}.jsonl`);
      try {
        const content = await fs.readFile(jsonl, "utf-8");
        return content
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line));
      } catch {
        return [];
      }
    };

    it("action-throw fires a command_executed { success: false } event with the right command + error_code", async () => {
      await runCliExpectSuccess(["telemetry", "enable"], { PAX8_CONFIG_DIR: tmpDir });

      // `invoices audit --month <bad>` throws synchronously from the action
      // via `validateMonth`. The action's own try/catch routes it to
      // `handleCommandError`, which should now emit the failure event
      // before flushing + exiting.
      const result = await runCli(
        ["invoices", "audit", "--month", "garbage", "--json"],
        { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "1" },
      );
      expect(result.exitCode).not.toBe(0);

      const events = await readEvents(tmpDir);
      const failure = events.find(
        (e) => e.success === false && e.subcommand === "invoices.audit",
      );
      expect(failure, `expected an invoices.audit failure event in ${JSON.stringify(events)}`).toBeDefined();
      expect(failure!.error_code).toBe("ERROR_INVALID_INPUT");
      expect(failure!.command).toBe("invoices");
      expect(Array.isArray(failure!.flags)).toBe(true);
    });

    it("opt-out users (telemetry disabled) emit nothing on failure", async () => {
      // No `telemetry enable` — telemetry is disabled by default.
      const result = await runCli(
        ["invoices", "audit", "--month", "garbage", "--json"],
        { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "1" },
      );
      expect(result.exitCode).not.toBe(0);
      const events = await readEvents(tmpDir);
      expect(events).toHaveLength(0);
    });

    it("Commander parse error (unknown command) fires a failure event (#598)", async () => {
      // Before #598, Commander's own parse errors short-circuited via its
      // internal `process.exit()` *before* the parseAsync.catch in
      // index.ts could run — so the failure-event path wired up in #597
      // never fired for typos / missing args, the highest-volume class
      // of user-facing failures. `program.exitOverride()` makes Commander
      // throw instead, and the throw lands in `handleCommandError` which
      // already maps `commander.*` codes to ERROR_INVALID_INPUT.
      //
      // `command` / `subcommand` are "unknown" here because preAction
      // never ran (parse failed before any action dispatched). That's
      // the right shape per the issue body: we want to see that *some*
      // failure happened, even if we can't attribute it to a specific
      // subcommand.
      await runCliExpectSuccess(["telemetry", "enable"], { PAX8_CONFIG_DIR: tmpDir });

      const result = await runCli(["bogus-command-that-does-not-exist"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.exitCode).not.toBe(0);

      const events = await readEvents(tmpDir);
      const failure = events.find(
        (e) => e.success === false && e.error_code === "ERROR_INVALID_INPUT",
      );
      expect(
        failure,
        `expected a Commander parse-error failure event in ${JSON.stringify(events)}`,
      ).toBeDefined();
      expect(failure!.subcommand).toBe("unknown");
      expect(failure!.command).toBe("unknown");
    });

    it("human render of a Commander parse error includes the `pax8 --help` hint (#598)", async () => {
      // claude-review follow-up: the envelope's recoverySteps now name the
      // help command, but the human path was previously dropping it for
      // Commander parse errors (they fell through to the generic Error
      // arm that prints only the message). Pin the symmetric behavior so
      // interactive users see the same hint as agents consuming --json.
      const result = await runCli(["bogus-command-that-does-not-exist"], {
        PAX8_OUTPUT_FORMAT: "table",
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/unknown command/);
      expect(result.stderr).toMatch(/pax8 --help/);
    });

    it("Commander parse error on a SUBCOMMAND also fires a failure event (#598)", async () => {
      // The exitOverride() + outputError config on the root program must
      // inherit to subcommands so a missing-required-arg on
      // `subscriptions show` (or any other subcommand) reaches our
      // handler the same way a root-level unknown command does. This is
      // the cross-version assumption worth pinning — Commander v12
      // propagates `_exitCallback` / `_outputConfiguration` via
      // `copyInheritedSettings` at dispatch, but it's exactly the kind
      // of thing that could regress on a future Commander bump.
      await runCliExpectSuccess(["telemetry", "enable"], { PAX8_CONFIG_DIR: tmpDir });

      // `subscriptions show` requires a positional `<id>` arg. Without
      // it, Commander throws `commander.missingArgument`.
      const result = await runCli(["subscriptions", "show"], {
        PAX8_CONFIG_DIR: tmpDir,
      });
      expect(result.exitCode).not.toBe(0);
      // Verify Commander's bare `error: …` stderr line was suppressed —
      // our envelope owns the surface now.
      expect(result.stderr).not.toMatch(/^error: missing required argument/m);

      const events = await readEvents(tmpDir);
      const failure = events.find(
        (e) => e.success === false && e.error_code === "ERROR_INVALID_INPUT",
      );
      expect(
        failure,
        `expected a subcommand parse-error failure event in ${JSON.stringify(events)}`,
      ).toBeDefined();
    });

    // #621: `credentialed` flag — both success and failure paths.
    //
    // The contract: `credentialed = true` iff `CredentialStore.hasCredentials()`
    // is true (env vars OR file). Independent of `demo_mode`. Tests run under
    // `PAX8_DEMO=1` because the existing pattern in this file does — demo
    // is independent of the credentialed signal, and using it keeps every
    // test on the same fast in-memory path the rest of the suite uses.
    //
    // Important: `runCli` inherits `process.env`, so a developer running
    // these locally with real `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` in
    // their shell would see the "no creds" tests fail. We pass empty
    // strings for those env vars in the no-creds cases — `getFromEnv()`
    // in credential-store.ts requires both to be truthy, so the empty
    // string disables the env-var path without unsetting (which
    // execFile's env merge doesn't support).
    describe("credentialed flag (#621)", () => {
      const NO_CREDS_ENV = { PAX8_CLIENT_ID: "", PAX8_CLIENT_SECRET: "" };

      it("success path emits credentialed: true when env vars are set", async () => {
        await runCliExpectSuccess(["telemetry", "enable"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        await runCliExpectSuccess(["clients", "list", "--json"], {
          PAX8_CONFIG_DIR: tmpDir,
          PAX8_CLIENT_ID: "test-client-id",
          PAX8_CLIENT_SECRET: "test-client-secret",
        });

        const events = await readEvents(tmpDir);
        const success = events.find(
          (e) => e.success === true && e.subcommand === "clients.list",
        );
        expect(
          success,
          `expected a clients.list success event in ${JSON.stringify(events)}`,
        ).toBeDefined();
        expect(success!.credentialed).toBe(true);
      });

      it("success path emits credentialed: true when a credentials file exists", async () => {
        await runCliExpectSuccess(["telemetry", "enable"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });
        // Write a credentials file directly into the temp config dir.
        // hasCredentials() only stats the path — it doesn't read or parse,
        // so any content is fine.
        await fs.writeFile(
          path.join(tmpDir, "credentials.json"),
          JSON.stringify({ clientId: "x", clientSecret: "y" }),
          { mode: 0o600 },
        );

        await runCliExpectSuccess(["clients", "list", "--json"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        const events = await readEvents(tmpDir);
        const success = events.find(
          (e) => e.success === true && e.subcommand === "clients.list",
        );
        expect(
          success,
          `expected a clients.list success event in ${JSON.stringify(events)}`,
        ).toBeDefined();
        expect(success!.credentialed).toBe(true);
      });

      it("success path emits credentialed: false when no env vars and no file", async () => {
        await runCliExpectSuccess(["telemetry", "enable"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        await runCliExpectSuccess(["clients", "list", "--json"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        const events = await readEvents(tmpDir);
        const success = events.find(
          (e) => e.success === true && e.subcommand === "clients.list",
        );
        expect(
          success,
          `expected a clients.list success event in ${JSON.stringify(events)}`,
        ).toBeDefined();
        expect(success!.credentialed).toBe(false);
      });

      it("failure path emits credentialed: true when env vars are set", async () => {
        await runCliExpectSuccess(["telemetry", "enable"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        // Same shape as the action-throw test above — invoices audit
        // with a bad --month flag throws ERROR_INVALID_INPUT from the
        // action, which routes through emitFailureEvent.
        const result = await runCli(
          ["invoices", "audit", "--month", "garbage", "--json"],
          {
            PAX8_CONFIG_DIR: tmpDir,
            PAX8_DEMO: "1",
            PAX8_CLIENT_ID: "test-client-id",
            PAX8_CLIENT_SECRET: "test-client-secret",
          },
        );
        expect(result.exitCode).not.toBe(0);

        const events = await readEvents(tmpDir);
        const failure = events.find(
          (e) => e.success === false && e.subcommand === "invoices.audit",
        );
        expect(
          failure,
          `expected an invoices.audit failure event in ${JSON.stringify(events)}`,
        ).toBeDefined();
        expect(failure!.credentialed).toBe(true);
      });

      it("failure path emits credentialed: false when no env vars and no file", async () => {
        await runCliExpectSuccess(["telemetry", "enable"], {
          PAX8_CONFIG_DIR: tmpDir,
          ...NO_CREDS_ENV,
        });

        const result = await runCli(
          ["invoices", "audit", "--month", "garbage", "--json"],
          { PAX8_CONFIG_DIR: tmpDir, PAX8_DEMO: "1", ...NO_CREDS_ENV },
        );
        expect(result.exitCode).not.toBe(0);

        const events = await readEvents(tmpDir);
        const failure = events.find(
          (e) => e.success === false && e.subcommand === "invoices.audit",
        );
        expect(
          failure,
          `expected an invoices.audit failure event in ${JSON.stringify(events)}`,
        ).toBeDefined();
        expect(failure!.credentialed).toBe(false);
      });
    });

    it("Commander --help and --version do NOT emit failure events (#598)", async () => {
      // exitOverride makes Commander throw for --help / --version too,
      // but those are user-requested content (not errors). The
      // isCommanderSuccessExit branch in handleCommandError exits 0
      // silently with no envelope and no telemetry track.
      await runCliExpectSuccess(["telemetry", "enable"], { PAX8_CONFIG_DIR: tmpDir });

      // Snapshot any events the `telemetry enable` itself emitted, then
      // assert the --help / --version runs add nothing.
      const before = await readEvents(tmpDir);

      const helpResult = await runCli(["--help"], { PAX8_CONFIG_DIR: tmpDir });
      expect(helpResult.exitCode).toBe(0);

      const versionResult = await runCli(["--version"], { PAX8_CONFIG_DIR: tmpDir });
      expect(versionResult.exitCode).toBe(0);

      const after = await readEvents(tmpDir);
      // No new events from --help / --version (length is stable).
      expect(after.length).toBe(before.length);
    });
  });
});
