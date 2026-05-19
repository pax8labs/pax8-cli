// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigDir, safeWriteFileSync } from "@pax8/core";

interface LastListEntry {
  index: number;
  id: string;
  name: string;
}

function filePath(): string {
  return path.join(getConfigDir(), "last-list.json");
}

/**
 * Save a numbered list of resources so subsequent commands can reference by number.
 *
 * #469: routed through `safeWriteFileSync` so the file is created with mode
 * `0o600` atomically and refuses to follow a symlink at the destination.
 * Partner-tenant business data (company names + IDs) lives in this cache; on
 * a shared host or CI runner the default umask would otherwise leave it
 * world-readable.
 */
export async function saveLastList(items: LastListEntry[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath()), { recursive: true });
    safeWriteFileSync(filePath(), JSON.stringify(items));
  } catch {
    // Non-fatal — don't break the CLI if cache write fails
  }
}

/**
 * Resolve a user input that could be a number (#), UUID, or name.
 * Returns the ID if found, or the original input if not a number.
 */
export async function resolveFromLastList(input: string): Promise<{ id: string; name: string } | null> {
  const num = parseInt(input, 10);
  if (isNaN(num) || String(num) !== input.trim()) return null;

  try {
    const content = await fs.readFile(filePath(), "utf-8");
    const items: LastListEntry[] = JSON.parse(content);
    const match = items.find((i) => i.index === num);
    if (match) return { id: match.id, name: match.name };
  } catch {
    // Cache doesn't exist or is corrupt
  }
  return null;
}
