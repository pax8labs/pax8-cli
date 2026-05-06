// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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

// #170: positional-arg redaction. The existing rules (UUID/email/path/JWT/
// long token) don't catch a normal "Acme Corp"-shaped string, so the
// redactor needs an opt-in pass driven by the original argv values.
describe("redactString with argTokens", () => {
  it("replaces a single full-word token with <REDACTED:ARG>", () => {
    expect(redactString("Company not found: Acme", ["Acme"])).toBe(
      "Company not found: <REDACTED:ARG>",
    );
  });

  it("replaces a multi-word company name with one <REDACTED:ARG>", () => {
    const out = redactString(
      'Company not found: "Real Customer Inc"',
      ["Real Customer Inc"],
    );
    expect(out).toBe('Company not found: "<REDACTED:ARG>"');
  });

  it("does not substring-match the token inside larger words", () => {
    // argTokens=["Inc"] must NOT scrub "Inc" out of "Incident".
    const out = redactString(
      "An Incident occurred for Inc on Tuesday",
      ["Inc"],
    );
    expect(out).toBe("An Incident occurred for <REDACTED:ARG> on Tuesday");
  });

  it("strips multiple occurrences of the same token", () => {
    const out = redactString("Acme failed; retried Acme; gave up.", ["Acme"]);
    expect(out).toBe(
      "<REDACTED:ARG> failed; retried <REDACTED:ARG>; gave up.",
    );
  });

  it("strips multiple distinct tokens, longest-first", () => {
    // If we scrubbed shortest-first, "Real Customer Inc" containing "Inc"
    // would get partially eaten. Sort longest-first inside the redactor.
    const out = redactString(
      'Failed for "Real Customer Inc" then "Inc"',
      ["Inc", "Real Customer Inc"],
    );
    expect(out).toBe('Failed for "<REDACTED:ARG>" then "<REDACTED:ARG>"');
  });

  it("treats regex metacharacters in tokens as literal", () => {
    // argTokens come straight from argv — they may contain `.`, `(`, `*`, etc.
    const out = redactString("Bad query: a.b.c (test)", ["a.b.c", "(test)"]);
    expect(out).toBe("Bad query: <REDACTED:ARG> <REDACTED:ARG>");
  });

  it("skips tokens shorter than 2 characters", () => {
    // A 1-char positional arg ("a", "x") would cause runaway over-redaction
    // across an English message; skip to be safe.
    const out = redactString("a quick brown fox", ["a"]);
    expect(out).toBe("a quick brown fox");
  });

  it("skips empty / whitespace-only tokens", () => {
    expect(redactString("hello world", ["", "  "])).toBe("hello world");
  });

  it("argToken pass runs before generic rules so it doesn't fight them", () => {
    // A 32-char token-shaped positional arg should still be replaced with
    // <REDACTED:ARG>, not <REDACTED:TOKEN>, since argToken is more specific.
    const tok = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"; // 32 chars, mixed
    const out = redactString(`secret=${tok} done`, [tok]);
    expect(out).toBe("secret=<REDACTED:ARG> done");
  });

  it("is a no-op when argTokens is empty (existing rules unchanged)", () => {
    const out = redactString("hello world", []);
    expect(out).toBe("hello world");
  });
});

describe("redactEnvelope with argTokens (#170)", () => {
  it("scrubs the company name from message, command, and causes", () => {
    // Reproduces the leak in #170: a company name typed at the CLI shows up
    // in command (via argv concat) and in message (via CliError interpolation).
    const env: BugReportEnvelope = {
      code: "ERROR_COMPANY_NOT_FOUND",
      message: 'Failed to show company: Company not found: "Real Customer Inc"',
      causes: ["Tried to fetch Real Customer Inc from /companies/by-name"],
      recoverySteps: ["Check the spelling of Real Customer Inc and try again"],
      command: "companies show Real Customer Inc",
      flags: ["--json"],
    };
    const out = redactEnvelope(env, ["Real Customer Inc"]);
    const all = JSON.stringify(out);
    expect(all).not.toContain("Real Customer Inc");
    expect(out.message).toContain("<REDACTED:ARG>");
    expect(out.causes?.[0]).toContain("<REDACTED:ARG>");
    expect(out.recoverySteps?.[0]).toContain("<REDACTED:ARG>");
    expect(out.command).toContain("<REDACTED:ARG>");
    // Non-PII metadata pass-through unchanged.
    expect(out.code).toBe("ERROR_COMPANY_NOT_FOUND");
    expect(out.flags).toEqual(["--json"]);
  });

  it("default (no argTokens) preserves prior behavior — non-pattern names slip through", () => {
    // Documents the pre-fix behavior so a future regression that *removes*
    // the argTokens param doesn't silently start reverting #170.
    const env: BugReportEnvelope = {
      message: 'Company not found: "Acme Corp"',
    };
    const out = redactEnvelope(env);
    // No argTokens → "Acme Corp" survives (it doesn't match any other rule).
    expect(out.message).toContain("Acme Corp");
  });

  it("argTokens does not break the existing UUID / path / token rules", () => {
    const env: BugReportEnvelope = {
      message:
        "client_id=a1b2c3d4-e5f6-7890-abcd-ef1234567890 for Acme at /Users/jdoe/.pax8",
    };
    const out = redactEnvelope(env, ["Acme"]);
    expect(out.message).toContain("<REDACTED:UUID>");
    expect(out.message).toContain("<REDACTED:PATH>");
    expect(out.message).toContain("<REDACTED:ARG>");
    expect(out.message).not.toContain("Acme");
    expect(out.message).not.toContain("jdoe");
  });
});
