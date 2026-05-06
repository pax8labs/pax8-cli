// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { getConfigDir } from "@pax8/core";

export const configPathCommand = new Command("path")
  .description("Print config directory path")
  .addHelpText(
    "after",
    `
Examples:
  pax8 config path`
  )
  .action(async () => {
    process.stdout.write(getConfigDir() + "\n");
  });
