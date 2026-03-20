import chalk from "chalk";

/**
 * Returns a snarky time-based quip, or null if the current time isn't notable.
 * Call this before command output to occasionally surprise the user.
 */
export function getTimeQuip(): string | null {
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
