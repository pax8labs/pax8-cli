import { Command } from "commander";
import chalk from "chalk";

const STAGES = [
  { pct: 0, msg: "Warming up the machine..." },
  { pct: 15, msg: "Grinding beans..." },
  { pct: 30, msg: "Negotiating with vendor..." },
  { pct: 45, msg: "Waiting on partner approval..." },
  { pct: 55, msg: "Reconciling milk inventory..." },
  { pct: 70, msg: "Escalating to tier 2 barista..." },
  { pct: 80, msg: "Resolving merge conflicts in the cream..." },
  { pct: 90, msg: "Applying hotfix to espresso shot..." },
  { pct: 100, msg: "Done!" },
];

function renderBar(pct: number): string {
  const width = 30;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = chalk.green("\u2593").repeat(filled) + chalk.gray("\u2591").repeat(empty);
  return `[${bar}] ${String(pct).padStart(3)}%`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const coffeeCommand = new Command("coffee")
  .description("Brew a mass-produced cup of artisanal CLI coffee")
  .helpOption(false)
  .action(async () => {
    console.log();

    for (const stage of STAGES) {
      const bar = renderBar(stage.pct);
      process.stdout.write(`\r  ${bar}  ${stage.msg.padEnd(45)}`);
      await sleep(400 + Math.random() * 600);
    }

    process.stdout.write("\n\n");
    console.log(chalk.yellow("  \u2615 Your coffee is ready. Back to work."));
    console.log();
  });
