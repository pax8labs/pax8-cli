export interface CommandContext {
  api: any; // Will be typed later when core API client is built
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

  // Placeholder API client — will be replaced with real/mock client
  const api = isDemo ? { _demo: true } : { _demo: false };

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
