// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { FileCache } from "@pax8/core";

/**
 * Clear all cached API responses after a write operation.
 * Writes are infrequent, so a full cache clear is the simplest
 * way to ensure stale data isn't served after mutations.
 */
export async function invalidateCacheAfterWrite(): Promise<void> {
  try {
    const cache = new FileCache();
    await cache.clear();
  } catch {
    // Best-effort — don't let cache errors break writes
  }
}
