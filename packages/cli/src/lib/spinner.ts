import ora, { type Ora } from "ora";

export function createSpinner(text: string): Ora {
  const isDisabled =
    !process.stderr.isTTY || process.env.PAX8_QUIET === "1";

  return ora({
    text,
    stream: process.stderr,
    isEnabled: !isDisabled,
  });
}
