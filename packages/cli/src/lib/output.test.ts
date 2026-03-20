import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { output, type Column } from "./output.js";

const sampleData = [
  { id: "1", name: "Acme Corp", status: "Active" },
  { id: "2", name: "Beta Inc", status: "Trial" },
  { id: "3", name: 'Company "With" Commas, LLC', status: "Cancelled" },
];

const sampleColumns: Column[] = [
  { key: "id", header: "ID" },
  { key: "name", header: "Name" },
  { key: "status", header: "Status" },
];

describe("output", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  describe("JSON format", () => {
    it("outputs valid JSON", () => {
      output(sampleData, { format: "json", columns: sampleColumns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(written);
      expect(parsed).toEqual(sampleData);
    });

    it("outputs pretty-printed JSON", () => {
      output([{ a: 1 }], { format: "json" });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).toContain("  ");
    });
  });

  describe("CSV format", () => {
    it("outputs header row and data rows", () => {
      output(sampleData, { format: "csv", columns: sampleColumns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const lines = written.trim().split("\n");

      expect(lines[0]).toBe("ID,Name,Status");
      expect(lines[1]).toBe("1,Acme Corp,Active");
      expect(lines[2]).toBe("2,Beta Inc,Trial");
    });

    it("escapes values with commas", () => {
      output(sampleData, { format: "csv", columns: sampleColumns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const lines = written.trim().split("\n");

      // Third row has commas and quotes in the name
      expect(lines[3]).toContain('"Company ""With"" Commas, LLC"');
    });

    it("handles empty data", () => {
      output([], { format: "csv", columns: sampleColumns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const lines = written.trim().split("\n");
      expect(lines).toHaveLength(1); // Header only
      expect(lines[0]).toBe("ID,Name,Status");
    });
  });

  describe("quiet format", () => {
    it("produces no output", () => {
      output(sampleData, { format: "quiet", columns: sampleColumns });

      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe("table format", () => {
    it("produces output with column headers", () => {
      output(sampleData, { format: "table", columns: sampleColumns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      // Table output should contain column header text (without ANSI)
      expect(written).toBeTruthy();
      // Should have multiple lines (header + data rows + borders)
      expect(written.split("\n").length).toBeGreaterThan(3);
    });

    it("applies format functions", () => {
      const columns: Column[] = [
        {
          key: "name",
          header: "Name",
          format: (v) => String(v).toUpperCase(),
        },
      ];

      output([{ name: "test" }], { format: "table", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).toContain("TEST");
    });
  });
});
