import { Command } from "commander";
import chalk from "chalk";
import { getTelemetry, TELEMETRY_NOTICE } from "@pax8/core";

const telemetryStatusCommand = new Command("status")
  .description("Show telemetry status and privacy details")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.loadEnabled();
    const enabled = telemetry.isEnabled();

    process.stdout.write(
      `\n  Telemetry is ${enabled ? chalk.green("enabled") : chalk.yellow("disabled")}\n`,
    );
    process.stdout.write(chalk.dim(TELEMETRY_NOTICE) + "\n");
  });

const telemetryEnableCommand = new Command("enable")
  .description("Enable anonymous usage telemetry")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.enable();
    process.stdout.write(`\n  ${chalk.green("\u2713")} Telemetry enabled\n`);
    process.stdout.write(chalk.dim(TELEMETRY_NOTICE) + "\n");
  });

const telemetryDisableCommand = new Command("disable")
  .description("Disable anonymous usage telemetry")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.disable();
    process.stdout.write(
      `\n  ${chalk.green("\u2713")} Telemetry disabled. No data will be collected.\n\n`,
    );
  });

export function registerTelemetryCommands(program: Command): void {
  const telemetry = new Command("telemetry").description(
    "Manage anonymous usage telemetry",
  );

  telemetry.addCommand(telemetryStatusCommand);
  telemetry.addCommand(telemetryEnableCommand);
  telemetry.addCommand(telemetryDisableCommand);

  program.addCommand(telemetry);
}
