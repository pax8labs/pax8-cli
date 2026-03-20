import { MockPax8Client } from "@pax8/core";

export interface CommandContext {
  api: MockPax8Client | any; // MockPax8Client in demo mode, real client otherwise
  outputFormat: "table" | "json" | "csv" | "quiet";
  config: any;
  isDemo: boolean;
  verbose: boolean;
}

export interface GlobalOptions {
  json?: boolean;
  csv?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  noColor?: boolean;
  config?: string;
  parent?: any;
}

export function getOutputFormat(
  options: GlobalOptions
): "table" | "json" | "csv" | "quiet" {
  if (options.quiet) return "quiet";
  if (options.json) return "json";
  if (options.csv) return "csv";

  // Non-TTY defaults to JSON (piped output)
  if (!process.stdout.isTTY) return "json";

  // Default to table
  return "table";
}

export async function buildContext(
  options: GlobalOptions
): Promise<CommandContext> {
  const isDemo = process.env.PAX8_DEMO === "1";
  const outputFormat = getOutputFormat(options);
  const verbose = options.verbose ?? false;

  // Use MockPax8Client in demo mode, placeholder otherwise
  const api = isDemo ? new MockPax8Client() : { _demo: false };

  // Placeholder config — will be replaced with real config loader
  const config = {
    defaults: {
      output_format: "table",
      page_size: 50,
      confirm_destructive: true,
    },
    cache: {
      enabled: true,
      ttl_hours: 24,
    },
  };

  return {
    api,
    outputFormat,
    config,
    isDemo,
    verbose,
  };
}
