// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { webhooksTopicsListCommand } from "./list.js";

export const webhooksTopicsCommand = new Command("topics").description(
  "Discover webhook topic definitions",
);

webhooksTopicsCommand.addCommand(webhooksTopicsListCommand);
