import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig, saveConfig, getConfigDir } from "../config/loader.js";

export interface TelemetryEvent {
  event: "command_executed";
  command: string;
  flags: string[];
  duration_ms: number;
  success: boolean;
  error_code?: string;
  cli_version: string;
  node_version: string;
  os: string;
  demo_mode: boolean;
}

export class Telemetry {
  private enabled: boolean;
  private buffer: TelemetryEvent[] = [];
  private storageDir: string;

  constructor() {
    this.storageDir = path.join(getConfigDir(), "telemetry");
    this.enabled = false;
    this.init();
  }

  private init(): void {
    // Environment variables always win — disable telemetry
    if (
      process.env.PAX8_TELEMETRY_DISABLED === "1" ||
      process.env.DO_NOT_TRACK === "1"
    ) {
      this.enabled = false;
      return;
    }
    // Config-based enable is resolved async via loadEnabled()
  }

  /**
   * Load the enabled state from config. Call this once at startup if you
   * need the config-file setting (constructor only checks env vars).
   */
  async loadEnabled(): Promise<void> {
    if (
      process.env.PAX8_TELEMETRY_DISABLED === "1" ||
      process.env.DO_NOT_TRACK === "1"
    ) {
      this.enabled = false;
      return;
    }
    try {
      const config = await loadConfig();
      this.enabled = config.telemetry.enabled;
    } catch {
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async enable(): Promise<void> {
    const config = await loadConfig();
    config.telemetry.enabled = true;
    await saveConfig(config);
    this.enabled = true;
  }

  async disable(): Promise<void> {
    const config = await loadConfig();
    config.telemetry.enabled = false;
    await saveConfig(config);
    this.enabled = false;
  }

  track(event: TelemetryEvent): void {
    if (!this.enabled) return;
    this.buffer.push(event);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    await fs.mkdir(this.storageDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filePath = path.join(this.storageDir, `${today}.jsonl`);

    const lines = this.buffer
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n";

    await fs.appendFile(filePath, lines, "utf-8");
    this.buffer = [];
  }
}

// Singleton
let instance: Telemetry | undefined;

export function getTelemetry(): Telemetry {
  if (!instance) {
    instance = new Telemetry();
  }
  return instance;
}

/** Reset singleton — useful for testing */
export function resetTelemetry(): void {
  instance = undefined;
}
