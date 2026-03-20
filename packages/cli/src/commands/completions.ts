import { Command } from "commander";
import chalk from "chalk";

const BASH_COMPLETION = `# pax8 bash completion
_pax8_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="auth config companies subscriptions products invoices orders doctor version completions"

  case "\${prev}" in
    auth)
      COMPREPLY=( $(compgen -W "login status logout" -- "\${cur}") )
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "init show set path" -- "\${cur}") )
      return 0
      ;;
    companies|subscriptions|products|invoices|orders)
      COMPREPLY=( $(compgen -W "list show" -- "\${cur}") )
      return 0
      ;;
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      return 0
      ;;
    pax8)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _pax8_completions pax8
`;

const ZSH_COMPLETION = `#compdef pax8

_pax8() {
  local -a commands
  commands=(
    'auth:Manage authentication with Pax8 API'
    'config:Manage CLI configuration'
    'companies:Manage companies'
    'subscriptions:Manage subscriptions'
    'products:Manage products'
    'invoices:Manage invoices'
    'orders:Manage orders'
    'doctor:Run diagnostic checks'
    'version:Print version information'
    'completions:Generate shell completion script'
  )

  _arguments -C \\
    '--json[Output as JSON]' \\
    '--csv[Output as CSV]' \\
    '--quiet[Suppress all output]' \\
    '--verbose[Show detailed output]' \\
    '--no-color[Disable color output]' \\
    '--config[Path to config file]:file:_files' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
  esac
}

_pax8 "$@"
`;

const FISH_COMPLETION = `# pax8 fish completion
complete -c pax8 -n '__fish_use_subcommand' -a auth -d 'Manage authentication with Pax8 API'
complete -c pax8 -n '__fish_use_subcommand' -a config -d 'Manage CLI configuration'
complete -c pax8 -n '__fish_use_subcommand' -a companies -d 'Manage companies'
complete -c pax8 -n '__fish_use_subcommand' -a subscriptions -d 'Manage subscriptions'
complete -c pax8 -n '__fish_use_subcommand' -a products -d 'Manage products'
complete -c pax8 -n '__fish_use_subcommand' -a invoices -d 'Manage invoices'
complete -c pax8 -n '__fish_use_subcommand' -a orders -d 'Manage orders'
complete -c pax8 -n '__fish_use_subcommand' -a doctor -d 'Run diagnostic checks'
complete -c pax8 -n '__fish_use_subcommand' -a version -d 'Print version information'
complete -c pax8 -n '__fish_use_subcommand' -a completions -d 'Generate shell completion script'

complete -c pax8 -n '__fish_seen_subcommand_from auth' -a login -d 'Authenticate with Pax8 API credentials'
complete -c pax8 -n '__fish_seen_subcommand_from auth' -a status -d 'Show current authentication status'
complete -c pax8 -n '__fish_seen_subcommand_from auth' -a logout -d 'Clear stored credentials'

complete -c pax8 -n '__fish_seen_subcommand_from config' -a init -d 'Create default configuration file'
complete -c pax8 -n '__fish_seen_subcommand_from config' -a show -d 'Display current configuration'
complete -c pax8 -n '__fish_seen_subcommand_from config' -a set -d 'Set a configuration value'
complete -c pax8 -n '__fish_seen_subcommand_from config' -a path -d 'Print config directory path'

complete -c pax8 -l json -d 'Output as JSON'
complete -c pax8 -l csv -d 'Output as CSV'
complete -c pax8 -l quiet -d 'Suppress all output'
complete -c pax8 -l verbose -d 'Show detailed output'
complete -c pax8 -l no-color -d 'Disable color output'
`;

export const completionsCommand = new Command("completions")
  .description("Generate shell completion script")
  .argument("<shell>", "Shell type: bash, zsh, or fish")
  .addHelpText(
    "after",
    `
Examples:
  pax8 completions bash >> ~/.bashrc
  pax8 completions zsh >> ~/.zshrc
  pax8 completions fish > ~/.config/fish/completions/pax8.fish`
  )
  .action(async (shell: string) => {
    const normalized = shell.toLowerCase();

    switch (normalized) {
      case "bash":
        process.stdout.write(BASH_COMPLETION);
        break;
      case "zsh":
        process.stdout.write(ZSH_COMPLETION);
        break;
      case "fish":
        process.stdout.write(FISH_COMPLETION);
        break;
      default:
        process.stderr.write(
          chalk.red(
            `\n  ✗ Unsupported shell: ${shell}\n  Supported: bash, zsh, fish\n\n`
          )
        );
        process.exit(1);
    }
  });
