import { Command } from "commander";
import chalk from "chalk";

const COW = `
        ${chalk.yellow("(  )")}
  ${chalk.white("^__^")}  ${chalk.yellow("/ /")}
  ${chalk.white("(oo)\\_______/")}
  ${chalk.white("(__)\\       )")}
   ${chalk.white("   ||----w |")}
   ${chalk.white("   ||     ||")}
`;

const QUOTES = [
  "Have you tried turning the subscription off and on again?",
  "This call could have been a CLI command.",
  "NCE renewals wait for no one.",
  "There is no cloud. It's just someone else's computer.",
  "Roses are red, tickets are due, the portal is down, and so are you.",
  "Keep calm and reconcile invoices.",
  "sudo make me a sandwich... and fix my licensing.",
  "It works on my tenant.",
  "404: Work-life balance not found.",
  "DNS: it's always DNS.",
];

export const mooCommand = new Command("moo")
  .description("...have you mooed today?")
  .helpOption(false)
  .action(() => {
    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    process.stdout.write(COW + "\n");
    process.stdout.write(`  ${chalk.cyan(`"${quote}"`)}\n`);
    process.stdout.write("\n");
  });
