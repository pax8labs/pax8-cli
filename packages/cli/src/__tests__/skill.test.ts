// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `pax8 skill install` (#720).
 *
 * The skill is the agent-facing safety contract, and until this command
 * existed it shipped in neither published artifact — `@pax8/cli` packs
 * only `dist`, `@pax8/claude-skill` is private. Partners running Claude
 * Code against `pax8` got an agent improvising around a CLI that can
 * place real orders.
 *
 * Every test here points `CLAUDE_CONFIG_DIR` (global scope) or `cwd`
 * (project scope) at a tmpdir. `vitest.real-home-guard-setup.ts` fails
 * the run if any of them escapes into the contributor's real
 * `~/.claude/skills/pax8`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CANONICAL_SKILL = path.join(REPO_ROOT, "packages/claude-skill/skill.md");

interface InstallResult {
  scope: string;
  path: string;
  action: string;
  previousState: string;
  cliVersion: string;
  checksum: string;
  restartRequired: boolean;
  nextActions: { command: string; args: string[]; isWrite: boolean }[];
}

let claudeDir: string;

beforeEach(async () => {
  claudeDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-skill-claude-"));
});

afterEach(async () => {
  await fs.rm(claudeDir, { recursive: true, force: true });
});

/** Global-scope install target inside the per-test tmp Claude dir. */
function globalSkillPath(): string {
  return path.join(claudeDir, "skills", "pax8", "SKILL.md");
}

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { CLAUDE_CONFIG_DIR: claudeDir, ...extra };
}

describe("pax8 skill install --print", () => {
  it("writes the canonical skill to stdout byte-for-byte", async () => {
    const canonical = await fs.readFile(CANONICAL_SKILL, "utf-8");
    const result = await runCliExpectSuccess(["skill", "install", "--print"], env());
    expect(result.stdout).toBe(canonical);
  });

  it("installs nothing — --print is a read", async () => {
    await runCliExpectSuccess(["skill", "install", "--print"], env());
    await expect(fs.access(globalSkillPath())).rejects.toThrow();
  });

  it("stays raw markdown under --json so the documented redirect works", async () => {
    // `pax8 skill install --print > SKILL.md` has to produce a skill file,
    // not a JSON envelope, regardless of the ambient output format.
    const result = await runCliExpectSuccess(["skill", "install", "--print", "--json"], env());
    expect(result.stdout.startsWith("---\nname: pax8\n")).toBe(true);
  });
});

describe("pax8 skill install", () => {
  it("creates the skill at the global target and reports the path", async () => {
    const result = await runCliExpectSuccess(["skill", "install", "--yes", "--json"], env());
    const payload = JSON.parse(result.stdout) as InstallResult;

    expect(payload.action).toBe("created");
    expect(payload.previousState).toBe("absent");
    expect(payload.scope).toBe("global");
    expect(payload.path).toBe(globalSkillPath());
    expect(payload.restartRequired).toBe(true);

    const written = await fs.readFile(globalSkillPath(), "utf-8");
    expect(written).toBe(await fs.readFile(CANONICAL_SKILL, "utf-8"));
  });

  it("records provenance next to the installed copy", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    const meta = JSON.parse(
      await fs.readFile(path.join(claudeDir, "skills", "pax8", ".pax8-skill.json"), "utf-8"),
    ) as { source: string; checksum: string; cliVersion: string };
    expect(meta.source).toBe("@pax8/cli");
    expect(meta.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(meta.cliVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is a no-op on a second run", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    const result = await runCliExpectSuccess(["skill", "install", "--yes", "--json"], env());
    const payload = JSON.parse(result.stdout) as InstallResult;
    expect(payload.action).toBe("unchanged");
    expect(payload.previousState).toBe("current");
    expect(payload.restartRequired).toBe(false);
  });

  it("suggests `doctor` as a read-only follow-up", async () => {
    const result = await runCliExpectSuccess(["skill", "install", "--yes", "--json"], env());
    const payload = JSON.parse(result.stdout) as InstallResult;
    // #708: every emitted action carries spawn-safe argv + isWrite.
    expect(payload.nextActions.length).toBeGreaterThan(0);
    for (const action of payload.nextActions) {
      expect(action.args[0]).toBe("pax8");
      expect(action.isWrite).toBe(false);
    }
  });

  it("refuses to overwrite a copy it can't prove it wrote", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    await fs.appendFile(globalSkillPath(), "\nPartner's own note.\n", "utf-8");

    const result = await runCliExpectFailure(["skill", "install", "--yes"], env());
    expect(result.stderr).toContain("--force");
    // The refusal has to say what differs, or the partner's only option is
    // to guess whether their edits matter.
    expect(result.stderr).toMatch(/only in yours/);
  });

  it("overwrites a modified copy with --force", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    await fs.appendFile(globalSkillPath(), "\nPartner's own note.\n", "utf-8");

    const result = await runCliExpectSuccess(
      ["skill", "install", "--yes", "--force", "--json"],
      env(),
    );
    const payload = JSON.parse(result.stdout) as InstallResult;
    expect(payload.action).toBe("updated");
    expect(payload.previousState).toBe("modified");
    expect(await fs.readFile(globalSkillPath(), "utf-8")).toBe(
      await fs.readFile(CANONICAL_SKILL, "utf-8"),
    );
  });

  it("refreshes a stale-but-unedited copy without --force", async () => {
    // What a partner who installed once and upgraded the CLI five times
    // has on disk: our content, from an older version. Nothing of theirs
    // is at risk, so requiring --force here would make every upgrade
    // hostile — and a stale contract is the failure #720 exists to stop.
    const dir = path.join(claudeDir, "skills", "pax8");
    await fs.mkdir(dir, { recursive: true });
    const oldContent = "---\nname: pax8\ndescription: an older contract\n---\n\nOld.\n";
    await fs.writeFile(path.join(dir, "SKILL.md"), oldContent, "utf-8");
    const { createHash } = await import("node:crypto");
    await fs.writeFile(
      path.join(dir, ".pax8-skill.json"),
      JSON.stringify({
        source: "@pax8/cli",
        cliVersion: "0.0.1",
        installedAt: new Date(0).toISOString(),
        checksum: `sha256:${createHash("sha256").update(oldContent, "utf-8").digest("hex")}`,
      }) + "\n",
      "utf-8",
    );

    const result = await runCliExpectSuccess(["skill", "install", "--yes", "--json"], env());
    const payload = JSON.parse(result.stdout) as InstallResult;
    expect(payload.action).toBe("updated");
    expect(payload.previousState).toBe("stale");
    expect(await fs.readFile(globalSkillPath(), "utf-8")).toBe(
      await fs.readFile(CANONICAL_SKILL, "utf-8"),
    );
  });

  it("installs into the project when --project is passed", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-skill-project-"));
    try {
      const result = await runCliExpectSuccess(
        ["skill", "install", "--project", "--yes", "--json"],
        env(),
        { cwd: projectDir },
      );
      const payload = JSON.parse(result.stdout) as InstallResult;
      expect(payload.scope).toBe("project");
      const written = await fs.readFile(
        path.join(projectDir, ".claude", "skills", "pax8", "SKILL.md"),
        "utf-8",
      );
      expect(written).toBe(await fs.readFile(CANONICAL_SKILL, "utf-8"));
      // The global target must be untouched — scope is not advisory.
      await expect(fs.access(globalSkillPath())).rejects.toThrow();
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  });

  it("rejects --global and --project together", async () => {
    const result = await runCliExpectFailure(
      ["skill", "install", "--global", "--project", "--yes"],
      env(),
    );
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("refuses to install unattended without --yes", async () => {
    // Subprocess stdin is not a TTY. Falling through to confirm()'s default
    // here would let an agent drop an instruction file into the partner's
    // Claude config without them ever seeing it.
    const result = await runCliExpectFailure(["skill", "install"], env());
    expect(result.stderr).toContain("not a TTY");
    expect(result.stderr).toContain("--yes");
    await expect(fs.access(globalSkillPath())).rejects.toThrow();
  });

  it("honors PAX8_YES=1 like every other write", async () => {
    const result = await runCliExpectSuccess(["skill", "install"], env({ PAX8_YES: "1" }));
    expect(result.exitCode).toBe(0);
    await fs.access(globalSkillPath());
  });

  // POSIX only. The refusal rides on `O_NOFOLLOW` (ELOOP on open), which
  // doesn't exist on Windows — there a symlinked SKILL.md reads as an
  // ordinary file with different contents and lands in `modified`, still
  // refused without --force. Creating a symlink on Windows also needs
  // elevation, so the fixture itself wouldn't build.
  it.skipIf(process.platform === "win32")("refuses to write through a symlink", async () => {
    // A symlink here is almost always deliberate — someone pointed the
    // skill at a checkout. Replacing it silently would break that setup.
    const dir = path.join(claudeDir, "skills", "pax8");
    await fs.mkdir(dir, { recursive: true });
    const decoy = path.join(claudeDir, "decoy.md");
    await fs.writeFile(decoy, "decoy\n", "utf-8");
    await fs.symlink(decoy, path.join(dir, "SKILL.md"));

    const result = await runCliExpectFailure(["skill", "install", "--yes", "--force"], env());
    expect(result.stderr).toContain("symlink");
    expect(await fs.readFile(decoy, "utf-8")).toBe("decoy\n");
  });

  it("shows help with examples", async () => {
    const result = await runCliExpectSuccess(["skill", "install", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--print");
  });
});

describe("pax8 doctor — installed-skill drift (#720)", () => {
  const TABLE = { PAX8_OUTPUT_FORMAT: "table" };

  it("passes with a nudge when no skill is installed", async () => {
    const result = await runCliExpectSuccess(["doctor"], env(TABLE), { cwd: claudeDir });
    expect(result.stdout).toMatch(/✓\s+Claude skill/);
    expect(result.stdout).toContain("not installed");
  });

  it("passes when the installed copy matches what the CLI ships", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    const result = await runCliExpectSuccess(["doctor"], env(TABLE), { cwd: claudeDir });
    expect(result.stdout).toMatch(/✓\s+Claude skill/);
    expect(result.stdout).toContain("up to date");
  });

  it("fails and names the fix when the installed copy has drifted", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    await fs.appendFile(globalSkillPath(), "\nDrift.\n", "utf-8");

    const result = await runCliExpectSuccess(["doctor"], env(TABLE), { cwd: claudeDir });
    expect(result.stdout).toMatch(/✗\s+Claude skill/);
    expect(result.stdout).toContain("pax8 skill install");
  });

  it("emits a write-flagged nextAction for the drift in --json mode", async () => {
    await runCliExpectSuccess(["skill", "install", "--yes"], env());
    await fs.appendFile(globalSkillPath(), "\nDrift.\n", "utf-8");

    const result = await runCli(["doctor", "--json"], env(), { cwd: claudeDir });
    const payload = JSON.parse(result.stdout) as {
      nextActions: { command: string; args: string[]; isWrite: boolean }[];
    };
    const action = payload.nextActions.find((a) => a.command.startsWith("pax8 skill install"));
    expect(action, "doctor should suggest refreshing a drifted skill").toBeDefined();
    // `skill install` writes into ~/.claude; an agent must confirm first.
    expect(action?.isWrite).toBe(true);
    expect(action?.args).toEqual(["pax8", "skill", "install"]);
  });
});
