import { describe, it, expect } from "vitest";
import { redactString, redactEnvelope, type BugReportEnvelope } from "./redactor.js";

describe("redactString", () => {
  describe("UUIDs", () => {
    it("redacts a Pax8-style client_id UUID", () => {
      const out = redactString("client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 failed");
      expect(out).toBe("client_id=<REDACTED:UUID> failed");
    });

    it("redacts uppercase UUIDs", () => {
      const out = redactString("ID: A1B2C3D4-E5F6-7890-ABCD-EF1234567890");
      expect(out).toBe("ID: <REDACTED:UUID>");
    });

    it("redacts multiple UUIDs in one string", () => {
      const out = redactString(
        "from a1b2c3d4-e5f6-7890-abcd-ef1234567890 to f9e8d7c6-b5a4-3210-fedc-ba0987654321"
      );
      expect(out).toBe("from <REDACTED:UUID> to <REDACTED:UUID>");
    });

    it("does not redact short hex strings that look UUID-ish but aren't", () => {
      // 12345678-1234-1234 (no fourth segment) — not a UUID
      const out = redactString("partial 12345678-1234-1234 abc");
      expect(out).toContain("12345678-1234-1234");
    });
  });

  describe("emails", () => {
    it("redacts a plain email", () => {
      expect(redactString("contact admin@example.com please")).toBe(
        "contact <REDACTED:EMAIL> please"
      );
    });

    it("redacts emails with plus-aliases", () => {
      expect(redactString("from user.name+tag@example.co.uk")).toBe(
        "from <REDACTED:EMAIL>"
      );
    });
  });

  describe("home paths", () => {
    it("redacts macOS user paths and preserves the suffix", () => {
      const out = redactString("config at /Users/jdoe/.pax8/config.yaml");
      expect(out).toBe("config at <REDACTED:PATH>/.pax8/config.yaml");
    });

    it("redacts Linux user paths and preserves the suffix", () => {
      const out = redactString("/home/alice/.pax8/last-error.json missing");
      expect(out).toBe("<REDACTED:PATH>/.pax8/last-error.json missing");
    });

    it("redacts Windows user paths and preserves the suffix", () => {
      const out = redactString(
        "wrote C:\\Users\\Bob\\.pax8\\config.yaml ok"
      );
      expect(out).toContain("<REDACTED:PATH>");
      expect(out).toContain(".pax8");
      expect(out).not.toContain("Bob");
    });

    it("redacts tilde paths", () => {
      expect(redactString("see ~/.pax8/last-error.json")).toBe(
        "see <REDACTED:PATH>/.pax8/last-error.json"
      );
    });

    it("does not eat tilde when not followed by a path", () => {
      expect(redactString("about ~10 minutes ago")).toContain("~10 minutes");
    });

    it("redacts a bare home dir with no suffix", () => {
      expect(redactString("at /Users/jdoe/")).toBe("at <REDACTED:PATH>/");
    });
  });

  describe("JWTs and bearer tokens", () => {
    it("redacts a JWT", () => {
      const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV";
      const out = redactString(`Authorization: ${jwt}`);
      expect(out).toBe("Authorization: <REDACTED:JWT>");
    });

    it("redacts Bearer prefix tokens", () => {
      const out = redactString(
        "Authorization: Bearer abcdef1234567890ABCDEF==/+_-.xyz"
      );
      expect(out).toBe("Authorization: Bearer <REDACTED:TOKEN>");
    });
  });

  describe("opaque token blobs", () => {
    it("redacts long mixed-case+digit base64-shaped strings (>=32 chars)", () => {
      // 48 chars, mixed case + digits — looks like a Pax8 client_secret.
      const out = redactString(
        "secret=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGh done"
      );
      expect(out).toBe("secret=<REDACTED:TOKEN> done");
    });

    it("redacts a long hex blob", () => {
      // 40 chars hex (sha1-shaped).
      const out = redactString("hash=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 ok");
      expect(out).toBe("hash=<REDACTED:TOKEN> ok");
    });

    it("does not over-redact normal English words", () => {
      const out = redactString(
        "The Pax8 API returned an unexpected response. Try a different query."
      );
      expect(out).toBe(
        "The Pax8 API returned an unexpected response. Try a different query."
      );
    });

    it("does not redact short alphanumeric values like flag names", () => {
      const out = redactString("flag --json was set, page=0, size=2");
      expect(out).toBe("flag --json was set, page=0, size=2");
    });

    it("does not redact a 31-character mixed string (under floor)", () => {
      const s = "Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1Ab1A"; // 31 chars
      expect(s.length).toBe(31);
      expect(redactString(`x=${s} y`)).toBe(`x=${s} y`);
    });
  });

  describe("idempotency", () => {
    it("running redactString twice yields the same output", () => {
      const first = redactString(
        "client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 at /Users/x/.pax8"
      );
      expect(redactString(first)).toBe(first);
    });
  });

  describe("non-string inputs", () => {
    it("returns empty input unchanged", () => {
      expect(redactString("")).toBe("");
    });
  });
});

describe("redactEnvelope", () => {
  it("redacts the message, causes, and recoverySteps fields", () => {
    const env: BugReportEnvelope = {
      code: "ERROR_AUTH_EXPIRED",
      message:
        "Auth failed for client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      causes: [
        "Token rejected: bearer Bearer abcdef1234567890ABCDEF==/+_-.xyz",
        "Email user@example.com on file",
      ],
      recoverySteps: ["Edit /Users/jdoe/.pax8/credentials.json"],
      docsUrl: "https://docs.pax8.com/auth",
      command: "auth login",
      flags: ["--json"],
      cli_version: "0.1.0",
      node_version: "v22.5.1",
      os: "darwin",
      timestamp: "2026-05-05T12:00:00.000Z",
    };
    const out = redactEnvelope(env);

    expect(out.code).toBe("ERROR_AUTH_EXPIRED");
    expect(out.message).not.toContain("a1b2c3d4");
    expect(out.message).toContain("<REDACTED:UUID>");

    expect(out.causes?.[0]).toContain("<REDACTED:TOKEN>");
    expect(out.causes?.[0]).not.toContain("abcdef1234567890");
    expect(out.causes?.[1]).toContain("<REDACTED:EMAIL>");
    expect(out.causes?.[1]).not.toContain("user@example.com");

    expect(out.recoverySteps?.[0]).toContain("<REDACTED:PATH>");
    expect(out.recoverySteps?.[0]).not.toContain("jdoe");

    // Pass-throughs.
    expect(out.docsUrl).toBe("https://docs.pax8.com/auth");
    expect(out.command).toBe("auth login");
    expect(out.flags).toEqual(["--json"]);
    expect(out.cli_version).toBe("0.1.0");
    expect(out.os).toBe("darwin");
  });

  it("regression: a realistic Pax8 401 envelope leaks no PII", () => {
    const env: BugReportEnvelope = {
      code: "ERROR_AUTH_EXPIRED",
      message:
        "Pax8 API returned 401 Unauthorized for client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      causes: [
        'Body: {"error":"invalid_token","error_description":"Token expired at 2026-05-05T11:59:59Z"}',
        "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhMWIyYzNkNCJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV",
        "Cached at /Users/jdulberger/.pax8/cache/auth-token.json",
      ],
      recoverySteps: ["Run pax8 auth login to refresh"],
      docsUrl: "https://docs.pax8.com/auth",
      command: "companies.list",
      flags: ["--company", "--json"],
      cli_version: "0.1.0",
      node_version: "v22.5.1",
      os: "darwin",
      timestamp: "2026-05-05T12:00:00.000Z",
    };
    const out = redactEnvelope(env);
    const all = JSON.stringify(out);
    // No raw UUID, no JWT, no home username, no email.
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    expect(all).not.toContain("jdulberger");
    expect(all).not.toMatch(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/);
    // But the markers should appear so reviewers see what was stripped.
    expect(all).toContain("<REDACTED:UUID>");
    expect(all).toContain("<REDACTED:JWT>");
    expect(all).toContain("<REDACTED:PATH>");
  });

  it("regression: a Zod issue path containing a company name is redacted", () => {
    const env: BugReportEnvelope = {
      code: "ERROR_API_VALIDATION",
      message: "The Pax8 API returned an unexpected response.",
      causes: [
        '"data.companies[0].id": expected string, got null at /Users/jdoe/.pax8/cache/companies.json',
      ],
      cli_version: "0.1.0",
      os: "darwin",
    };
    const out = redactEnvelope(env);
    const all = JSON.stringify(out);
    expect(all).not.toContain("jdoe");
    expect(all).toContain("<REDACTED:PATH>");
  });

  it("preserves the structural shape (no extra fields, omits unset ones)", () => {
    const env: BugReportEnvelope = { message: "hi" };
    const out = redactEnvelope(env);
    expect(out).toEqual({ message: "hi" });
  });

  it("handles undefined optional arrays safely", () => {
    const env: BugReportEnvelope = { message: "x" };
    const out = redactEnvelope(env);
    expect(out.causes).toBeUndefined();
    expect(out.recoverySteps).toBeUndefined();
    expect(out.flags).toBeUndefined();
  });
});
