import chalk from "chalk";
import Table from "cli-table3";

export interface Column {
  key: string;
  header: string;
  width?: number;
  format?: (value: unknown) => string;
}

export interface OutputOptions {
  format: "table" | "json" | "csv" | "quiet";
  columns?: Column[];
}

function escapeCSV(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function formatTable(data: Record<string, unknown>[], columns: Column[]): void {
  const table = new Table({
    head: columns.map((col) => chalk.cyan.bold(col.header)),
    style: {
      head: [],
      border: [],
      "padding-left": 1,
      "padding-right": 1,
    },
    colWidths: columns.map((col) => col.width ?? null),
  });

  for (const row of data) {
    table.push(
      columns.map((col) => {
        const raw = row[col.key];
        const value = raw === undefined || raw === null ? "" : raw;
        return col.format ? col.format(value) : String(value);
      })
    );
  }

  // Two-space indent for table output
  const lines = table.toString().split("\n");
  for (const line of lines) {
    process.stdout.write("  " + line + "\n");
  }
}

function formatJSON(data: Record<string, unknown>[]): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function formatCSV(data: Record<string, unknown>[], columns: Column[]): void {
  // Header row
  const header = columns.map((col) => escapeCSV(col.header)).join(",");
  process.stdout.write(header + "\n");

  // Data rows
  for (const row of data) {
    const line = columns
      .map((col) => {
        const raw = row[col.key];
        const value = raw === undefined || raw === null ? "" : String(raw);
        return escapeCSV(value);
      })
      .join(",");
    process.stdout.write(line + "\n");
  }
}

export function output(data: Record<string, unknown>[], options: OutputOptions): void {
  const { format, columns } = options;

  if (format === "quiet") {
    return;
  }

  if (format === "json") {
    formatJSON(data);
    return;
  }

  if (!columns || columns.length === 0) {
    if (format === "table") {
      // Fallback: show as JSON if no columns defined
      formatJSON(data);
    } else if (format === "csv") {
      // Infer columns from first item
      if (data.length > 0) {
        const inferred: Column[] = Object.keys(data[0]).map((key) => ({
          key,
          header: key,
        }));
        formatCSV(data, inferred);
      }
    }
    return;
  }

  if (format === "table") {
    formatTable(data, columns);
  } else if (format === "csv") {
    formatCSV(data, columns);
  }
}
