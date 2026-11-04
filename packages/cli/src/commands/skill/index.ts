// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { skillInstallCommand } from "./install.js";

export function registerSkillCommands(program: Command): void {
  const skill = new Command("skill").description(
    "Manage the Claude Code skill that teaches agents this CLI's safety contract",
  );
  skill.addCommand(skillInstallCommand);
  program.addCommand(skill);
}
