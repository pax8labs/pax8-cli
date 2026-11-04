// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { redactDebugBody } from "@pax8/core";

/**
 * Emit a `[debug] ...` line to stderr when `PAX8_DEBUG` is set.
 *
 * The message runs through `redactDebugBody` first, which strips
 * `Bearer <token>`, JWTs, `client_secret(...)` values, and long opaque
 * blobs. The verbose API response-body printing path in `Pax8Client.request`
 * has used this redactor since #263; this helper is the CLI-side equivalent
 * for the half-dozen ad-hoc `if (process.env.PAX8_DEBUG) process.stderr.write(...)`
 * sites that were emitting raw `Error.message` (which for an `ApiError`
 * carries whatever the upstream echoed back, including credentials in 401
 * paths). `PAX8_DEBUG_RAW=1` opts back into unredacted output.
 *
 * The PAX8_DEBUG gate is checked here so callers can drop the boilerplate
 * `if (process.env.PAX8_DEBUG)` wrap.
 */
export function debugLog(label: string, err: unknown): void {
  if (!process.env.PAX8_DEBUG) return;
  const raw = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[debug] ${label}: ${redactDebugBody(raw)}\n`);
}
