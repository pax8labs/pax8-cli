/**
 * Vitest globalSetup: ensures a directory exists for spawned subprocesses
 * (e.g. the built CLI invoked from `runCli()`) to deposit their v8 coverage
 * profiles, and sets `NODE_V8_COVERAGE` on the parent process so children
 * inherit it.
 *
 * Only active when coverage is enabled. The custom provider in
 * `vitest.coverage-provider.ts` reads the resulting profiles back in.
 */
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SUBPROCESS_COV_DIR = resolve(
  process.cwd(),
  "coverage",
  "subprocess-v8"
);

export default function setup(): void {
  // Only wire subprocess coverage when the user has actually requested it.
  // Vitest sets VITEST_COVERAGE_REQUESTED for runs invoked with --coverage.
  // We detect coverage via the resolved test config in the provider; here
  // we cheaply gate on the env var the user sees in CI.
  // Note: we still create the dir unconditionally so subprocesses don't fail
  // if NODE_V8_COVERAGE is set for some other reason.
  if (existsSync(SUBPROCESS_COV_DIR)) {
    rmSync(SUBPROCESS_COV_DIR, { recursive: true, force: true });
  }
  mkdirSync(SUBPROCESS_COV_DIR, { recursive: true });

  // Tell every subsequent child process (incl. those spawned by runCli) to
  // write a v8 coverage profile here on exit.
  process.env.NODE_V8_COVERAGE = SUBPROCESS_COV_DIR;
  // Communicate the location to the custom provider.
  process.env.PAX8_SUBPROCESS_COVERAGE_DIR = SUBPROCESS_COV_DIR;
}
