// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliExpectFailure, runCliExpectSuccess } from "./test-utils.js";

/**
 * Builds an isolated config dir with `demo: true` written into config.yaml.
 * Returns the dir path; callers must pass it as `PAX8_CONFIG_DIR` and also
 * unset `PAX8_DEMO` (the test harness sets it to "1" by default) so the
 * config-source branch is exercised rather than the env-source branch.
 */
async function makeConfigPinnedDemoDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-demo-config-"));
  await fs.writeFile(
    path.join(dir, "config.yaml"),
    "version: '1.0'\ndemo: true\n",
    "utf-8",
  );
  return dir;
}

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

    it("accepts credentials via flags (non-interactive path) — under demo mode, surfaces conflict", async () => {
      // Demo mode short-circuits before validation, but the flag-parsing
      // path still runs — proves the non-interactive contract is intact.
      // Regression for the silent-no-op trap: when credentials are supplied
      // but demo mode is active, the user previously saw a green-check
      // "authenticated" with no signal that creds weren't saved. Now we
      // emit a stderr warning and embed a `notice` in the JSON envelope.
      const result = await runCliExpectSuccess([
        "auth",
        "login",
        "--client-id",
        "test-id-with-valid-chars",
        "--client-secret",
        "test-secret-with-valid-chars",
      ]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("authenticated");
      expect(parsed.mode).toBe("demo");
      expect(parsed.demoSource).toBe("env");
      expect(parsed.notice).toMatch(/demo mode/i);
      expect(parsed.notice).toMatch(/not saved/i);
      // Loud stderr warning so interactive users notice the conflict.
      expect(result.stderr).toMatch(/Demo mode is active/);
      expect(result.stderr).toMatch(/credentials were NOT saved/);
    });

    it("`nextActions` entries are spawnable argv — no shell metacharacters (#612)", async () => {
      // Pinned by #612 after claude-review on #608 flagged that the
      // two-step "unset PAX8_DEMO && pax8 auth login" entries violated
      // the #562 argv contract — agents consume `args` directly and
      // never tokenize `command` or pipe it to a shell. Every entry's
      // `command` must be a single `pax8 …` invocation; the `notice`
      // field above (asserted by the earlier test in this block) is
      // where the disable-demo guidance lives now.
      const result = await runCliExpectSuccess([
        "auth",
        "login",
        "--client-id",
        "test-id-with-valid-chars",
        "--client-secret",
        "test-secret-with-valid-chars",
      ]);
      const parsed = JSON.parse(result.stdout);
      const actions = parsed.nextActions as Array<{ command: string }>;
      // Every command starts with `pax8 ` — no leading `unset`, `cd`, etc.
      for (const a of actions) {
        expect(a.command, `nextAction ${JSON.stringify(a)} must start with "pax8 "`).toMatch(/^pax8 /);
      }
      // No shell metacharacters anywhere in any command — &&, ||, ;,
      // pipe, redirect, command substitution, backticks.
      const shellMetaRe = /(&&|\|\||;|[|<>$`])/;
      for (const a of actions) {
        expect(
          shellMetaRe.test(a.command),
          `nextAction ${JSON.stringify(a)} contains shell metacharacters; agents cannot spawn this safely`,
        ).toBe(false);
      }
    });

    it("bare `auth login` in demo mode adds a dim source hint to the human banner", async () => {
      const result = await runCliExpectSuccess(["auth", "login"], {
        PAX8_OUTPUT_FORMAT: "table",
      });
      // The dim chalk styling drops the actual codes in non-TTY, but the
      // literal text is preserved.
      expect(result.stderr).toContain("Authenticated");
      expect(result.stderr).toContain("demo source: env");
    });

    it("bare `auth login` in demo mode (no creds) does NOT emit a notice", async () => {
      const result = await runCliExpectSuccess(["auth", "login"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.status).toBe("authenticated");
      expect(parsed.notice).toBeUndefined();
    });

    it("detects `source: config` when PAX8_DEMO is unset but config.demo is true", async () => {
      // Reproduces Dori's likely entry path: `pax8 init --demo` (or
      // `pax8 demo on`) pinned `demo: true` in config.yaml. Without the
      // config-source branch, `auth login` would attempt real cred entry
      // — but every downstream command still hits the mock client because
      // `buildContext()` honors config.demo. The fix is to detect this
      // here too so the user sees the conflict at login time.
      const dir = await makeConfigPinnedDemoDir();
      try {
        const result = await runCliExpectSuccess(
          [
            "auth",
            "login",
            "--client-id",
            "real-id-1234",
            "--client-secret",
            "real-secret-5678",
          ],
          {
            PAX8_DEMO: "",
            PAX8_CONFIG_DIR: dir,
            PAX8_CLIENT_ID: "",
            PAX8_CLIENT_SECRET: "",
          },
        );
        const parsed = JSON.parse(result.stdout);
        expect(parsed.mode).toBe("demo");
        expect(parsed.demoSource).toBe("config");
        expect(parsed.notice).toMatch(/source: config/);
        expect(result.stderr).toMatch(/source: config/);
        expect(result.stderr).toMatch(/pax8 demo off/);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
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

    // --- #610: `--browser` flag --------------------------------------------

    it("advertises --browser in help with a one-line description (#610)", async () => {
      const result = await runCliExpectSuccess(["auth", "login", "--help"]);
      expect(result.stdout).toContain("--browser");
      // Affirmatively name what gets opened so the help line is actionable.
      expect(result.stdout.toLowerCase()).toMatch(/browser/);
    });

    it("with --browser, invokes the opener with the credentials URL (#610)", async () => {
      // Stub the opener via PAX8_OPEN_URL_LOG: openUrl() appends the URL to
      // the file path instead of spawning a real `open` / `xdg-open`. Lets
      // us assert the opener was called with the right URL from a subprocess
      // test without launching a browser on the CI box.
      //
      // PAX8_OUTPUT_FORMAT=table forces the human/table path: subprocess
      // stdout is non-TTY, so `getOutputFormat()` would otherwise resolve
      // to `json`, and the `--browser` block is gated on `!jsonMode` so an
      // agent passing `--json` never gets a stray GUI browser.
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        await runCli(["auth", "login", "--browser"], {
          PAX8_DEMO: "",
          PAX8_CLIENT_ID: "",
          PAX8_CLIENT_SECRET: "",
          PAX8_OPEN_URL_LOG: logPath,
          PAX8_OUTPUT_FORMAT: "table",
        });
        const logged = await fs.readFile(logPath, "utf-8");
        expect(logged.trim()).toBe(
          "https://app.pax8.com/integrations/credentials",
        );
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });

    it("with --browser, prints a 'what to do there' hint pointing at the credentials page (#610)", async () => {
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        const result = await runCli(["auth", "login", "--browser"], {
          PAX8_DEMO: "",
          PAX8_CLIENT_ID: "",
          PAX8_CLIENT_SECRET: "",
          PAX8_OPEN_URL_LOG: logPath,
          PAX8_OUTPUT_FORMAT: "table",
        });
        // One-line "what we're opening / what to do" message lands on
        // stderr per the stdout-is-data contract.
        expect(result.stderr).toContain(
          "https://app.pax8.com/integrations/credentials",
        );
        expect(result.stderr.toLowerCase()).toMatch(/paste|client id/);
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });

    it("with --browser, the prompt flow continues after the opener returns (#610)", async () => {
      // Subprocess stdin is non-TTY, so the interactive prompt block is
      // skipped — but the post-open code still runs and falls through to
      // the missing-creds error path. Asserting that we get the normal
      // missing-creds error (not a hang, not a crash) proves the flow
      // continued past the browser-open step rather than blocking on it.
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        const result = await runCli(["auth", "login", "--browser"], {
          PAX8_DEMO: "",
          PAX8_CLIENT_ID: "",
          PAX8_CLIENT_SECRET: "",
          PAX8_OPEN_URL_LOG: logPath,
          PAX8_OUTPUT_FORMAT: "table",
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(
          /Missing credentials|client-id/,
        );
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });

    it("with --browser and a no-opener fallback, prints the URL plainly and continues (#610)", async () => {
      // PAX8_OPEN_URL_SUCCESS=0 makes the stubbed opener report failure
      // (headless / SSH / missing-binary simulation). The CLI must print
      // the URL plainly on stderr and proceed — never block, never crash.
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        const result = await runCli(["auth", "login", "--browser"], {
          PAX8_DEMO: "",
          PAX8_CLIENT_ID: "",
          PAX8_CLIENT_SECRET: "",
          PAX8_OPEN_URL_LOG: logPath,
          PAX8_OPEN_URL_SUCCESS: "0",
          PAX8_OUTPUT_FORMAT: "table",
        });
        // URL is printed (twice — once in the intro line, once in the
        // fallback hint — both fine).
        expect(result.stderr).toContain(
          "https://app.pax8.com/integrations/credentials",
        );
        expect(result.stderr.toLowerCase()).toMatch(
          /could not launch|open this url manually/,
        );
        // Flow proceeds to the normal missing-creds error (no hang).
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(
          /Missing credentials|client-id/,
        );
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });

    it("--browser is a no-op short-circuit under demo mode (no opener call) (#610)", async () => {
      // Demo mode short-circuits the whole login flow before the
      // browser-open block, so the opener must not be called even with
      // --browser. Matches the demo contract — every flag is a no-op
      // short-circuit under PAX8_DEMO=1.
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        await runCliExpectSuccess(["auth", "login", "--browser"], {
          PAX8_OPEN_URL_LOG: logPath,
        });
        // Either the file doesn't exist (preferred) or it's empty — both
        // prove the opener was not called.
        const exists = await fs
          .stat(logPath)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          const logged = await fs.readFile(logPath, "utf-8");
          expect(logged).toBe("");
        }
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });

    it("--browser + --json does NOT open a browser (no GUI from agent invocations) (#610)", async () => {
      // Agents and CI scripts pass `--json` for machine-readable output.
      // Spawning a GUI browser during a machine-driven invocation is
      // surprising and useless — there's no human to paste into the prompt.
      // The flow should fall straight through to the structured
      // missing-creds error without ever calling the opener.
      const logPath = path.join(os.tmpdir(), `pax8-open-url-${Date.now()}.log`);
      try {
        const result = await runCli(["auth", "login", "--browser", "--json"], {
          PAX8_DEMO: "",
          PAX8_CLIENT_ID: "",
          PAX8_CLIENT_SECRET: "",
          PAX8_OPEN_URL_LOG: logPath,
        });
        // Opener was not invoked.
        const exists = await fs
          .stat(logPath)
          .then(() => true)
          .catch(() => false);
        if (exists) {
          const logged = await fs.readFile(logPath, "utf-8");
          expect(logged).toBe("");
        }
        // And the flow proceeded to the normal missing-creds error path.
        expect(result.exitCode).not.toBe(0);
        const haystack = result.stderr + result.stdout;
        expect(haystack).toMatch(/Missing credentials|ERROR_AUTH_MISSING/);
      } finally {
        await fs.rm(logPath, { force: true });
      }
    });
  });

  describe("auth status", () => {
    // Subprocess stdout is non-TTY, so per the agent-first contract (#210)
    // `auth status` auto-emits JSON. We assert on the structured shape and
    // separately verify the human path via the explicit format helpers.
    // Field renamed from `authenticated` to `credentialsPresent` in #573 —
    // the previous name implied an API-backed validity check the command
    // doesn't actually perform.
    it("emits JSON in non-TTY (agent-first default)", async () => {
      const result = await runCliExpectSuccess(["auth", "status"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.credentialsPresent).toBe(true);
      expect(parsed.mode).toBe("demo");
    });

    it("emits JSON when --json is passed explicitly", async () => {
      const result = await runCliExpectSuccess(["auth", "status", "--json"]);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.credentialsPresent).toBe(true);
      expect(parsed.mode).toBe("demo");
      expect(parsed.demoSource).toBe("env");
    });

    it("surfaces demoSource:config + disable hint when config.demo:true", async () => {
      const dir = await makeConfigPinnedDemoDir();
      try {
        const result = await runCliExpectSuccess(["auth", "status", "--json"], {
          PAX8_DEMO: "",
          PAX8_CONFIG_DIR: dir,
        });
        const parsed = JSON.parse(result.stdout);
        expect(parsed.mode).toBe("demo");
        expect(parsed.demoSource).toBe("config");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it("includes a disable hint in human output (config source)", async () => {
      const dir = await makeConfigPinnedDemoDir();
      try {
        const result = await runCliExpectSuccess(["auth", "status"], {
          PAX8_DEMO: "",
          PAX8_CONFIG_DIR: dir,
          PAX8_OUTPUT_FORMAT: "table",
        });
        expect(result.stdout).toContain("Demo source: config");
        expect(result.stdout).toContain("pax8 demo off");
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
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
