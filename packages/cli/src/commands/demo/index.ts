// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { demoOnCommand } from "./on.js";
import { demoOffCommand } from "./off.js";
import { demoStatusCommand } from "./status.js";

export function registerDemoCommands(program: Command): void {
  const demo = new Command("demo").description(
    "Toggle persistent demo mode (in-memory sample data, no credentials)",
  );

  demo.addCommand(demoOnCommand);
  demo.addCommand(demoOffCommand);
  demo.addCommand(demoStatusCommand);

  program.addCommand(demo);
}
