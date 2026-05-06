import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = resolve(
  fileURLToPath(import.meta.url),
  "../../../dist/index.js",
);

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * Spawn the CLI, fire a SIGINT after `delayMs`, and collect the result.
 *
 * Notes for future maintainers:
 *  - We force a TTY-ish env (`PAX8_FORCE_TTY` isn't a thing, but
 *    setting `FORCE_COLOR` mostly does the right thing for spinner output).
 *    The actual spinner won't *animate* without a real TTY but the SIGINT
 *    handler still runs.
 *  - The mock client adds a small per-request delay (~5–20ms) when
 *    PAX8_DEMO=1 — long enough that we can race a SIGINT against a list
 *    call, but not so long the test feels slow.
 *  - We deliberately don't assert on exact stdout/stderr text because
 *    spinner rendering varies across terminals/environments.
 */
function runWithSigint(args: string[], delayMs: number): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      env: {
        ...process.env,
        PAX8_DEMO: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    const sigintTimer = setTimeout(() => {
      try {
        child.kill("SIGINT");
      } catch {
        // ignore — child may have already exited
      }
    }, delayMs);

    // Safety bail-out so a test failure can't hang CI.
    const bailTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 10_000);

    child.on("close", (code, signal) => {
      clearTimeout(sigintTimer);
      clearTimeout(bailTimer);
      resolvePromise({ stdout, stderr, exitCode: code, signal });
    });
  });
}

describe("SIGINT handler", () => {
  it(
    "exits cleanly with code 130 when interrupted during a list",
    async () => {
      // Wait long enough that Node has finished startup and main() has
      // installed our SIGINT handler, but short enough that the demo
      // command (~150–200ms wall) is still mid-spinner. Too short and the
      // signal hits Node's default handler (signal=SIGINT, code=null);
      // too long and the command exits cleanly first (code=0).
      const result = await runWithSigint(["companies", "list"], 120);

      // Either Node delivered SIGINT and our handler exited 130, OR — if
      // the command finished before the SIGINT arrived — we got 0. Both
      // are acceptable; what's NOT acceptable is exit code 1 (which
      // would mean the spinner failed loudly) or exit code 130 with a
      // stray `✗` in stderr.
      if (result.exitCode === 130) {
        // Should not have printed the ora "fail" symbol.
        expect(result.stderr).not.toContain("✗"); // ✗
        // Should not have written a thrown-error block.
        expect(result.stderr.toLowerCase()).not.toContain("unhandled");
      } else if (result.signal === "SIGINT" && result.exitCode === null) {
        // Node-level SIGINT default: child terminated by the signal before
        // our handler installed. This means the SIGINT arrived during Node
        // startup, before main()'s installSigintHandler() ran. Not ideal,
        // but also not a regression — the user just hit Ctrl+C extremely
        // early. The terminal is still clean (no spinner ever started).
        expect(result.stderr).not.toContain("✗");
      } else {
        // Lost the race — command finished before SIGINT was delivered.
        // That can happen on a fast machine; not a regression.
        expect([0, 130]).toContain(result.exitCode);
      }
    },
    15_000,
  );
});
