// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

/**
 * Returns a snarky time-based quip, or null if the current time isn't notable.
 * Call this before command output to occasionally surprise the user.
 *
 * Subprocess tests set `PAX8_DISABLE_QUIP=1` (via `runCli` in
 * `test-utils.ts`) so the time-of-day stderr line never lands in
 * assertion targets. Without that bypass, CI matrix runs that happen to
 * execute between 02:00–05:00 UTC (the "go to bed" quip), Monday before
 * 9 AM local, Friday after 4:30 PM, or the last two days of the month
 * flake any stderr-grep assertion in the suite. The flag is intentionally
 * internal — not documented in the UX guide or README — and only the
 * test harness should set it. See #620 for the original flake report.
 */
export function getTimeQuip(): string | null {
  if (process.env.PAX8_DISABLE_QUIP === "1") return null;
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday
  const date = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  // 3 AM club
  if (hour >= 2 && hour < 5) {
    return chalk.dim("  \ud83c\udf19 It's " + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ". You okay? Go to bed.");
  }

  // Friday after 4:30 PM
  if (day === 5 && hour >= 16 && (hour > 16 || now.getMinutes() >= 30)) {
    return chalk.dim("  \u26a0\ufe0f  It's Friday evening. Are you sure about this? The weekend is right there.");
  }

  // Monday before 9 AM
  if (day === 1 && hour < 9) {
    return chalk.dim("  \u2615 Monday morning. Brave. Proceed with caution.");
  }

  // Last 2 days of the month
  if (date >= daysInMonth - 1) {
    return chalk.dim("  \ud83d\udcc5 Billing closes soon. Godspeed.");
  }

  return null;
}
