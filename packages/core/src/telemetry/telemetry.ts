import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PostHog } from "posthog-node";
import { loadConfig, saveConfig, getConfigDir } from "../config/loader.js";

// PostHog project API key (public, write-only — safe to embed)
const POSTHOG_API_KEY = "phc_XKIa0EPGDACY1p4Cczk6IWXFa3n9";
const POSTHOG_HOST = "https://us.i.posthog.com";

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

export const TELEMETRY_NOTICE = `
  pax8 collects anonymous usage data to improve the tool.

  What we collect:
    Command names and flags used (never values or arguments)
    Success/failure and duration
    OS and Node.js version

  What we never collect:
    Company names, IDs, or subscription data
    Credentials, tokens, or API responses
    Any personally identifiable information

  You can opt out anytime:
    pax8 telemetry disable
    export PAX8_TELEMETRY_DISABLED=1
    export DO_NOT_TRACK=1

  Telemetry is OFF by default. Enable with: pax8 telemetry enable
`;

/**
 * Generate a stable, anonymous machine ID by hashing hostname + username.
 * No PII leaves the machine — only the SHA-256 hash is used as distinct_id.
 */
function getAnonymousId(): string {
  const raw = `${os.hostname()}:${os.userInfo().username}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export class Telemetry {
  private enabled: boolean;
  private buffer: TelemetryEvent[] = [];
  private storageDir: string;
  private posthog: PostHog | null = null;
  private anonymousId: string;

  constructor() {
    this.storageDir = path.join(getConfigDir(), "telemetry");
    this.enabled = false;
    this.anonymousId = getAnonymousId();
    this.init();
  }

  private init(): void {
    if (
      process.env.PAX8_TELEMETRY_DISABLED === "1" ||
      process.env.DO_NOT_TRACK === "1"
    ) {
      this.enabled = false;
      return;
    }
  }

  private getPostHog(): PostHog {
    if (!this.posthog) {
      this.posthog = new PostHog(POSTHOG_API_KEY, {
        host: POSTHOG_HOST,
        flushAt: 10,
        flushInterval: 0, // We flush manually
      });
    }
    return this.posthog;
  }

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

    const events = [...this.buffer];
    this.buffer = [];

    // Local JSONL backup
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const filePath = path.join(this.storageDir, `${today}.jsonl`);
      const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      await fs.appendFile(filePath, lines, "utf-8");
    } catch {
      // Local write failure is non-fatal
    }

    // Send to PostHog
    try {
      const ph = this.getPostHog();
      for (const event of events) {
        ph.capture({
          distinctId: this.anonymousId,
          event: event.event,
          properties: {
            command: event.command,
            flags: event.flags,
            duration_ms: event.duration_ms,
            success: event.success,
            error_code: event.error_code,
            cli_version: event.cli_version,
            node_version: event.node_version,
            os: event.os,
            demo_mode: event.demo_mode,
          },
        });
      }
      await ph.flush();
    } catch {
      // PostHog send failure is non-fatal — never break the CLI
    }
  }

  async shutdown(): Promise<void> {
    if (this.posthog) {
      try {
        await this.posthog.shutdown();
      } catch {
        // Ignore shutdown errors
      }
      this.posthog = null;
    }
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

export function resetTelemetry(): void {
  instance = undefined;
}
