// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { contactsListCommand } from "./list.js";
import { contactsShowCommand } from "./show.js";
import { contactsCreateCommand } from "./create.js";
import { contactsUpdateCommand } from "./update.js";
import { contactsDeleteCommand } from "./delete.js";

export function registerContactsCommands(program: Command): void {
  const contacts = new Command("contacts").description("Manage company contacts");

  contacts.addCommand(contactsListCommand);
  contacts.addCommand(contactsShowCommand);
  contacts.addCommand(contactsCreateCommand);
  contacts.addCommand(contactsUpdateCommand);
  contacts.addCommand(contactsDeleteCommand);

  program.addCommand(contacts);
}
