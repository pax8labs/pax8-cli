import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigDir } from "@pax8/core";

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
 */
export async function saveLastList(items: LastListEntry[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath()), { recursive: true });
    await fs.writeFile(filePath(), JSON.stringify(items), "utf-8");
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
