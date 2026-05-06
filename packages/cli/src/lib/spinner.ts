import ora, { type Ora } from "ora";

/**
 * Registry of currently-running spinners. We track these so the top-level
 * SIGINT handler in lib/signals.ts can clean them up without each command
 * having to wire its own listener.
 *
 * The wrapper around the Ora instance below adds/removes the spinner from
 * this set whenever its lifecycle methods (start/stop/succeed/fail) are
 * invoked.
 */
const activeSpinners = new Set<Ora>();

export function createSpinner(text: string): Ora {
  const isDisabled =
    !process.stderr.isTTY || process.env.PAX8_QUIET === "1";

  const spinner = ora({
    text,
    stream: process.stderr,
    isEnabled: !isDisabled,
  });

  // Wrap lifecycle methods so we can track which spinners are currently
  // animating. We bind the originals up front so we can call through them
  // without recursing.
  const originalStart = spinner.start.bind(spinner);
  const originalStop = spinner.stop.bind(spinner);
  const originalSucceed = spinner.succeed.bind(spinner);
  const originalFail = spinner.fail.bind(spinner);

  spinner.start = (startText?: string) => {
    activeSpinners.add(spinner);
    return originalStart(startText);
  };

  spinner.stop = () => {
    activeSpinners.delete(spinner);
    return originalStop();
  };

  spinner.succeed = (succeedText?: string) => {
    activeSpinners.delete(spinner);
    return originalSucceed(succeedText);
  };

  spinner.fail = (failText?: string) => {
    activeSpinners.delete(spinner);
    return originalFail(failText);
  };

  return spinner;
}

/**
 * Stop every currently-running spinner without printing the failure
 * symbol. Used by the SIGINT handler so Ctrl+C doesn't leave a stray
 * red `✗` on the terminal that reads like an error.
 *
 * Calls `.stop()` (which clears the spinner line) rather than `.fail()`,
 * then writes a newline so any subsequent output starts on a clean row.
 */
export function stopAllActiveSpinners(): void {
  if (activeSpinners.size === 0) return;

  // Snapshot so mutating the set inside the loop is safe.
  const snapshot = Array.from(activeSpinners);
  for (const spinner of snapshot) {
    try {
      spinner.stop();
    } catch {
      // Defensive: a misbehaving spinner shouldn't block cleanup of others.
    }
  }
  activeSpinners.clear();

  // Make sure the cursor lands on a fresh line — otherwise any text we
  // write right after this could end up tacked onto the (now-cleared)
  // spinner row.
  if (process.stderr.isTTY) {
    process.stderr.write("\n");
  }
}

/**
 * Test helper. Exposes the registry size so unit tests can assert on
 * tracking without reaching into module internals via reflection.
 */
export function _getActiveSpinnerCount(): number {
  return activeSpinners.size;
}
