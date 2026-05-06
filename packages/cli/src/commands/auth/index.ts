// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { authLoginCommand } from "./login.js";
import { authStatusCommand } from "./status.js";
import { authLogoutCommand } from "./logout.js";

export function registerAuthCommands(program: Command): void {
  const auth = new Command("auth").description(
    "Manage authentication with Pax8 API"
  );

  auth.addCommand(authLoginCommand);
  auth.addCommand(authStatusCommand);
  auth.addCommand(authLogoutCommand);

  program.addCommand(auth);
}
