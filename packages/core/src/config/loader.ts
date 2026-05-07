// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { ConfigSchema, type Config } from "./schema.js";
import { validateConfigDir } from "../security/validate-env.js";

const DEFAULT_CONFIG_DIR = path.join(homedir(), ".pax8");
const DEFAULT_CONFIG_FILE = "config.yaml";

export function getConfigDir(): string {
  // PAX8_CONFIG_DIR overrides the default so tests can isolate state per-test
  // and avoid clobbering the user's real ~/.pax8 dir. This is intentionally
  // read on every call so tests that set/unset the env var between runs are
  // honored without needing to reset module state.
  //
  // Security (#262): the override is run through `validateConfigDir` so a
  // value that resolves outside the user's home directory is rejected
  // before it can be used as a write target. The default ($HOME/.pax8)
  // path skips validation — there's nothing user-controllable to check.
  const override = process.env.PAX8_CONFIG_DIR;
  if (override && override.length > 0) {
    return validateConfigDir(override);
  }
  return DEFAULT_CONFIG_DIR;
}

export async function ensureConfigDir(): Promise<string> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function defaultConfigPath(): string {
  return path.join(getConfigDir(), DEFAULT_CONFIG_FILE);
}

function getDefaultConfig(): Config {
  return ConfigSchema.parse({ version: "1.0" });
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const filePath = configPath ?? defaultConfigPath();

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = YAML.parse(content);
    return ConfigSchema.parse(raw);
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string };
    if (e?.code === "ENOENT") {
      return getDefaultConfig();
    }
    // If it's a Zod validation error, re-throw as-is
    if (e?.name === "ZodError") {
      throw err;
    }
    throw err;
  }
}

export async function saveConfig(config: Config, configPath?: string): Promise<void> {
  const filePath = configPath ?? defaultConfigPath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const validated = ConfigSchema.parse(config);
  const content = YAML.stringify(validated);
  await fs.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
}
