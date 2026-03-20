import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import { ConfigSchema, type Config } from "./schema.js";

const DEFAULT_CONFIG_DIR = path.join(process.env.HOME ?? "~", ".pax8");
const DEFAULT_CONFIG_FILE = "config.yaml";

export function getConfigDir(): string {
  return DEFAULT_CONFIG_DIR;
}

export async function ensureConfigDir(): Promise<string> {
  const dir = getConfigDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function defaultConfigPath(): string {
  return path.join(DEFAULT_CONFIG_DIR, DEFAULT_CONFIG_FILE);
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
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return getDefaultConfig();
    }
    // If it's a Zod validation error, re-throw as-is
    if (err instanceof Error && err.name === "ZodError") {
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
  await fs.writeFile(filePath, content, "utf-8");
}
