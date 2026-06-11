// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawn, type SpawnOptions } from "node:child_process";
import { appendFileSync } from "node:fs";

/**
 * Spawner shape used by `openUrl`. Carved out as a type so tests can inject a
 * stub without monkey-patching `node:child_process`.
 */
export type Spawner = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions,
) => { on: (event: "error", listener: (err: Error) => void) => void; unref: () => void };

/**
 * Resolve the OS-native opener for a URL. Exposed so tests can assert the
 * argv shape per platform without spawning a real process.
 */
export function resolveOpener(
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: (url: string) => string[] } {
  if (platform === "darwin") {
    return { cmd: "open", args: (url) => [url] };
  }
  if (platform === "win32") {
    // `start` is a cmd.exe builtin; `""` is the empty title arg required when
    // the URL contains characters cmd would otherwise treat as a title.
    return { cmd: "cmd", args: (url) => ["/c", "start", "", url] };
  }
  return { cmd: "xdg-open", args: (url) => [url] };
}

/**
 * Cross-platform "open this URL in the user's default browser" using only
 * Node built-ins — deliberately avoids the `open` npm package since the
 * platform commands are stable and the call sites are few.
 *
 * Resolves to `true` if the opener spawned without error, `false` otherwise.
 * Headless environments (no `xdg-open`, no DISPLAY, SSH-only shells) report
 * `false` so callers can print the URL plainly and continue rather than
 * blocking on a browser that will never appear.
 *
 * Never throws — callers can `await` without try/catch.
 */
export async function openUrl(
  url: string,
  opts: {
    spawner?: Spawner;
    platform?: NodeJS.Platform;
    /**
     * Test hook: when truthy (default reads `PAX8_OPEN_URL_LOG`), the URL
     * that would have been opened is appended to that file path instead of
     * spawning a process. Returns the value of `PAX8_OPEN_URL_SUCCESS`
     * (`"0"` simulates a failed opener, anything else simulates success).
     * Internal — not part of the public CLI contract.
     */
     logPath?: string | null;
  } = {},
): Promise<boolean> {
  const logPath = opts.logPath ?? process.env.PAX8_OPEN_URL_LOG ?? null;
  if (logPath) {
    try {
      appendFileSync(logPath, url + "\n");
    } catch {
      // Don't let a logging-side failure cascade.
    }
    return process.env.PAX8_OPEN_URL_SUCCESS === "0" ? false : true;
  }
  const { cmd, args } = resolveOpener(opts.platform);
  const spawner = opts.spawner ?? ((c, a, o) => spawn(c, a, o));
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawner(cmd, args(url), {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => finish(false));
      child.unref();
      // The opener is detached; we don't wait for it to exit. Resolve next
      // tick so the caller can return — if `error` fires synchronously
      // (missing binary), the `false` branch above wins.
      setImmediate(() => finish(true));
    } catch {
      finish(false);
    }
  });
}
