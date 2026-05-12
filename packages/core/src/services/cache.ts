// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigDir } from "../config/loader.js";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class FileCache {
  // Honor `PAX8_CONFIG_DIR` (via `getConfigDir()`) so the cache follows
  // the config root. Previously hardcoded `~/.pax8/cache`, which meant
  // integration tests and any caller using `PAX8_CONFIG_DIR` got a
  // stale cross-invocation cache they couldn't redirect — surfaced
  // when the integration suite hit `[pax8] CACHE HIT` on rerun and the
  // wire-URL assertions had nothing to grep. Resolves on construction
  // so each `FileCache` pins the dir it was built with (matches the
  // prior behavior for callers that pass an explicit path).
  constructor(private cacheDir: string = path.join(getConfigDir(), "cache")) {}

  private filePath(key: string): string {
    // Sanitize key to be safe as filename
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.cacheDir, `${safeKey}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const content = await fs.readFile(this.filePath(key), "utf-8");
      const entry: CacheEntry<T> = JSON.parse(content);

      if (entry.expiresAt !== 0 && Date.now() > entry.expiresAt) {
        // Expired — clean up and return null
        await this.invalidate(key).catch(() => {});
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });

    const entry: CacheEntry<T> = {
      data: value,
      expiresAt: ttlMs ? Date.now() + ttlMs : 0,
    };

    const filePath = this.filePath(key);
    const tmpPath = filePath + ".tmp";

    await fs.writeFile(tmpPath, JSON.stringify(entry), { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmpPath, filePath);
  }

  async invalidate(key: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(key));
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async clear(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map((f) => fs.unlink(path.join(this.cacheDir, f)).catch(() => {})),
      );
    } catch {
      // Ignore if directory doesn't exist
    }
  }
}
