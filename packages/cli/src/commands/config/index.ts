// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { configInitCommand } from "./init.js";
import { configShowCommand } from "./show.js";
import { configSetCommand } from "./set.js";
import { configPathCommand } from "./path.js";

export function registerConfigCommands(program: Command): void {
  const config = new Command("config").description(
    "Manage CLI configuration"
  );

  config.addCommand(configInitCommand);
  config.addCommand(configShowCommand);
  config.addCommand(configSetCommand);
  config.addCommand(configPathCommand);

  program.addCommand(config);
}
