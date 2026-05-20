// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { PostHog } from "posthog-node";
import { loadConfig, saveConfig, getConfigDir } from "../config/loader.js";
import type { Pax8ErrorCode } from "../errors/codes.js";
import { safeWriteFileSync } from "../security/safe-write.js";

// PostHog project API key (public, write-only — safe to embed)
const POSTHOG_API_KEY = "phc_XKIa0EPGDACY1p4Cczk6IWXFa3n9";
const POSTHOG_HOST = "https://us.i.posthog.com";

export interface TelemetryEvent {
  event: "command_executed";
  command: string;
  flags: string[];
  duration_ms: number;
  success: boolean;
  /**
   * Set when the command was interrupted (SIGINT) before completing.
   * Always paired with `success: false` and `error_code: "ERROR_CANCELLED"`.
   */
  cancelled?: boolean;
  /**
   * Canonical machine-readable error code from `@pax8/core`'s `ERROR_*`
   * registry. Set on failed events (`success: false`); omitted on successful
   * ones. The README's Telemetry contract promises this vocabulary.
   */
  error_code?: Pax8ErrorCode;
  cli_version: string;
  node_version: string;
  os: string;
  demo_mode: boolean;
  /** Full subcommand path, e.g. "recommendations.list" */
  subcommand?: string;
  /** For order create, did the order actually succeed */
  order_success?: boolean;
  /**
   * Revenue: order total in dollars (unit_price × quantity) — RAW value
   * staged by command handlers. Bucketed (M-2 security review) before
   * leaving the machine; `order_total_bucket` is what actually ships.
   */
  order_total_dollars?: number;
  /** Revenue: monthly MRR impact of the order — RAW, see above. */
  order_mrr_impact?: number;
  /** Revenue: number of seats ordered — RAW, see above. */
  order_seats?: number;
  /** For order create: whether the run was a dry-run validation (no real write) */
  order_dry_run?: boolean;
  /** For order create: number of line items in the order — RAW, see above. */
  order_line_count?: number;
  /** For recommendations act: total recs presented */
  recs_presented?: number;
  /** For recommendations act: how many were ordered */
  recs_ordered?: number;
  /** For recommendations act: how many were skipped */
  recs_skipped?: number;
  /** For recommendations act: total MRR uplift of orders placed — RAW, see above. */
  recs_mrr_captured?: number;
}

/**
 * Bucket a dollar/MRR value into a coarse string range so an internal
 * employee with PostHog query access can't reverse a unique order size
 * back to the partner who placed it. The cuts are deliberately wide and
 * coarse — a small-MSP $40 order and a large-MSP $48 order both land in
 * "10-50".
 *
 * Strings (not numbers) so PostHog queries can't sum them back to a total.
 */
export function bucketDollars(value: number): string {
  if (!Number.isFinite(value) || value < 10) return "<10";
  if (value < 50) return "10-50";
  if (value < 200) return "50-200";
  if (value < 1000) return "200-1000";
  return ">1000";
}

/** Bucket a seat count. See {@link bucketDollars}. */
export function bucketSeats(value: number): string {
  if (!Number.isFinite(value) || value < 10) return "<10";
  if (value <= 50) return "10-50";
  return ">50";
}

/** Bucket a line-item count. See {@link bucketDollars}. */
export function bucketLineCount(value: number): string {
  if (!Number.isFinite(value) || value <= 1) return "1";
  if (value <= 5) return "2-5";
  return ">5";
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
 * Per-install salted distinct ID, stored at `<config-dir>/telemetry-id`.
 *
 * Prior versions derived this from `sha256(hostname + username).slice(0, 16)`,
 * which the M-2 security review flagged as easily de-anonymizable: anyone with
 * directory access could regenerate any user's distinct_id from the AD/LDAP
 * record. Migration is forward-only — events already attributed to the legacy
 * hostname-derived ID stay where they are; new events get the salted ID.
 *
 * On first call:
 *   - If `<config-dir>/telemetry-id` exists and contains a non-empty UUID,
 *     return that.
 *   - Else: generate `crypto.randomUUID()`, write it via `safeWriteFileSync`
 *     (atomic O_CREAT + 0o600 + O_NOFOLLOW), and return it.
 *
 * Failures (I/O error reading or writing) degrade to an ephemeral
 * per-process UUID. We never throw out of telemetry init — opting in must
 * never become a CLI-breaking decision.
 */
function getAnonymousId(): string {
  const dir = getConfigDir();
  const filePath = path.join(dir, "telemetry-id");

  try {
    if (fsSync.existsSync(filePath)) {
      const existing = fsSync.readFileSync(filePath, "utf-8").trim();
      if (existing.length > 0) return existing;
    }
  } catch {
    // Fall through to (re)generate.
  }

  const fresh = crypto.randomUUID();
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    safeWriteFileSync(filePath, fresh);
  } catch {
    // Disk full, permission denied, etc. — fall back to an ephemeral id
    // for this process. Better than crashing on telemetry init.
  }
  return fresh;
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
      await fs.appendFile(filePath, lines, { encoding: "utf-8", mode: 0o600 });
    } catch {
      // Local write failure is non-fatal
    }

    // Send to PostHog
    //
    // M-2 (security review): raw revenue fields (`order_total_dollars`,
    // `order_mrr_impact`, `recs_mrr_captured`, `order_seats`,
    // `order_line_count`) fingerprint partners when combined with the
    // distinct_id. Before transmission we bucket them into coarse string
    // ranges and rename the keys to `*_bucket` so downstream PostHog
    // queries can't accidentally sum them back to raw totals. The raw
    // numbers stay in the local JSONL backup (already 0o600) so the
    // operator can still audit their own machine's usage.
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
            ...(event.subcommand !== undefined && { subcommand: event.subcommand }),
            ...(event.cancelled !== undefined && { cancelled: event.cancelled }),
            ...(event.order_success !== undefined && { order_success: event.order_success }),
            ...(event.order_total_dollars !== undefined && {
              order_total_bucket: bucketDollars(event.order_total_dollars),
            }),
            ...(event.order_mrr_impact !== undefined && {
              order_mrr_bucket: bucketDollars(event.order_mrr_impact),
            }),
            ...(event.order_seats !== undefined && {
              order_seats_bucket: bucketSeats(event.order_seats),
            }),
            ...(event.order_dry_run !== undefined && { order_dry_run: event.order_dry_run }),
            ...(event.order_line_count !== undefined && {
              order_line_count_bucket: bucketLineCount(event.order_line_count),
            }),
            ...(event.recs_presented !== undefined && { recs_presented: event.recs_presented }),
            ...(event.recs_ordered !== undefined && { recs_ordered: event.recs_ordered }),
            ...(event.recs_skipped !== undefined && { recs_skipped: event.recs_skipped }),
            ...(event.recs_mrr_captured !== undefined && {
              recs_mrr_captured_bucket: bucketDollars(event.recs_mrr_captured),
            }),
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

  /**
   * Flush any buffered events and shut down the PostHog client, bounded by
   * `timeoutMs`. Used on the error-exit path so a hung PostHog connection
   * cannot stall the user's CLI before `process.exit`.
   *
   * Returns immediately (a resolved promise) when telemetry is disabled —
   * opt-out users pay no latency.
   */
  async flushAndShutdown(timeoutMs = 2000): Promise<void> {
    if (!this.enabled) return;
    if (this.buffer.length === 0 && !this.posthog) return;

    const work = (async (): Promise<void> => {
      try {
        await this.flush();
      } catch {
        // flush() already swallows internally; defensive belt + suspenders.
      }
      await this.shutdown();
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      // Don't keep the event loop alive on our account.
      timer.unref?.();
    });

    try {
      await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
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
