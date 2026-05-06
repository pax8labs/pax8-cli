// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { output, type Column } from "./output.js";

describe("output — extended coverage", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  describe("table format without columns", () => {
    it("falls back to JSON when no columns defined", () => {
      const data = [{ id: "1", name: "Test" }];
      output(data, { format: "table" });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(written);
      expect(parsed).toEqual(data);
    });

    it("falls back to JSON when columns array is empty", () => {
      const data = [{ id: "1" }];
      output(data, { format: "table", columns: [] });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const parsed = JSON.parse(written);
      expect(parsed).toEqual(data);
    });
  });

  describe("csv format without columns", () => {
    it("infers columns from first item", () => {
      const data = [
        { id: "1", name: "Acme", status: "Active" },
        { id: "2", name: "Beta", status: "Trial" },
      ];
      output(data, { format: "csv" });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const lines = written.trim().split("\n");
      expect(lines[0]).toBe("id,name,status");
      expect(lines[1]).toBe("1,Acme,Active");
    });

    it("produces no output when data is empty and no columns", () => {
      output([], { format: "csv" });

      // No columns to infer, so nothing should be output
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe("table format with null/undefined values", () => {
    it("handles null and undefined values in table rows", () => {
      const columns: Column[] = [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "missing", header: "Missing" },
      ];
      const data = [{ id: "1", name: null, missing: undefined }] as unknown as Record<string, unknown>[];
      output(data, { format: "table", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).toBeTruthy();
    });
  });

  describe("csv escaping edge cases", () => {
    it("escapes values with newlines", () => {
      const columns: Column[] = [{ key: "text", header: "Text" }];
      const data = [{ text: "line1\nline2" }];
      output(data, { format: "csv", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).toContain('"line1\nline2"');
    });

    it("escapes values with carriage returns", () => {
      const columns: Column[] = [{ key: "text", header: "Text" }];
      const data = [{ text: "line1\rline2" }];
      output(data, { format: "csv", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      expect(written).toContain('"line1\rline2"');
    });

    it("handles null values in csv", () => {
      const columns: Column[] = [
        { key: "id", header: "ID" },
        { key: "val", header: "Value" },
      ];
      const data = [{ id: "1", val: null }] as unknown as Record<string, unknown>[];
      output(data, { format: "csv", columns });

      const written = stdoutWrite.mock.calls.map((c) => c[0]).join("");
      const lines = written.trim().split("\n");
      expect(lines[1]).toBe("1,");
    });
  });
});
