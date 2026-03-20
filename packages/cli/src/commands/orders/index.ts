import { Command } from "commander";
import { ordersListCommand } from "./list.js";
import { ordersShowCommand } from "./show.js";
import { ordersCreateCommand } from "./create.js";

export function registerOrdersCommands(program: Command): void {
  const orders = new Command("orders").description("Manage orders");

  orders.addCommand(ordersListCommand);
  orders.addCommand(ordersShowCommand);
  orders.addCommand(ordersCreateCommand);

  program.addCommand(orders);
}
