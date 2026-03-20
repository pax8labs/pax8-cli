import { Command } from "commander";
import { productsListCommand } from "./list.js";
import { productsShowCommand } from "./show.js";
import { productsSearchCommand } from "./search.js";

export function registerProductsCommands(program: Command): void {
  const products = new Command("products").description("Manage products");

  products.addCommand(productsListCommand);
  products.addCommand(productsShowCommand);
  products.addCommand(productsSearchCommand);

  program.addCommand(products);
}
