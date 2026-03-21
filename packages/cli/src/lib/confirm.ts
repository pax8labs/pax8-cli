import { createInterface } from "readline";

function shouldAutoConfirm(): boolean {
  return (
    process.env.PAX8_YES === "1" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y")
  );
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
