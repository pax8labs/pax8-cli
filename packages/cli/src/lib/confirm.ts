import { createInterface } from "readline";

function shouldAutoConfirm(): boolean {
  return (
    process.env.PAX8_YES === "1" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y")
  );
}

/** In REPL mode, stdin is shared and prompts don't work. */
export function isReplMode(): boolean {
  return process.env.PAX8_REPL === "1";
}

/** Strip "pax8 " prefix from a command string when running in REPL mode. */
export function replCmd(cmd: string): string {
  if (isReplMode() && cmd.startsWith("pax8 ")) {
    return cmd.slice(5);
  }
  return cmd;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function confirm(
  message: string,
  options?: { default?: boolean }
): Promise<boolean> {
  if (shouldAutoConfirm()) return true;

  const defaultVal = options?.default ?? false;
  const hint = defaultVal ? "[y/n]" : "[y/n]";
  const answer = await prompt(`  ${message} ${hint} `);

  if (answer === "") return defaultVal;
  return answer.toLowerCase().startsWith("y");
}

export async function confirmDestructive(
  message: string,
  keyword: string
): Promise<boolean> {
  if (shouldAutoConfirm()) return true;

  const answer = await prompt(
    `  ${message}\n  Type "${keyword}" to confirm: `
  );

  return answer === keyword;
}
