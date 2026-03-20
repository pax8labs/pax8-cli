import { Command } from "commander";
import { getTelemetry } from "@pax8/core";

const telemetryStatusCommand = new Command("status")
  .description("Show whether telemetry is enabled or disabled")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.loadEnabled();
    const status = telemetry.isEnabled() ? "enabled" : "disabled";
    process.stdout.write(`Telemetry is ${status}\n`);
  });

const telemetryEnableCommand = new Command("enable")
  .description("Enable anonymous usage telemetry")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.enable();
    process.stdout.write("Telemetry enabled\n");
  });

const telemetryDisableCommand = new Command("disable")
  .description("Disable anonymous usage telemetry")
  .action(async () => {
    const telemetry = getTelemetry();
    await telemetry.disable();
    process.stdout.write("Telemetry disabled\n");
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
