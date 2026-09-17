// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "../../__tests__/test-utils.js";
import { DISPUTE_COPY } from "./dispute.js";

describe("invoices dispute (closed-loop counterpart to audit)", () => {
  let disputesDir: string;
  let idemDir: string;

  beforeEach(async () => {
    disputesDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-dispute-"));
    idemDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-dispute-idem-"));
  });

  afterEach(async () => {
    await fs.rm(disputesDir, { recursive: true, force: true });
    await fs.rm(idemDir, { recursive: true, force: true });
  });

  it("happy path: files a dispute draft from a discrepancy ID in demo mode", async () => {
    // First run audit to grab a real discrepancy ID
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    expect(report.discrepancies.length).toBeGreaterThan(0);
    const discId = report.discrepancies[0].discrepancyId;
    expect(discId).toMatch(/^disc-[a-f0-9]{12}$/);

    // Audit's nextActions should now point at the dispute command
    expect(report.nextActions[0].command).toContain("invoices dispute --discrepancy");

    // File the dispute
    const result = await runCliExpectSuccess(
      ["invoices", "dispute", "--discrepancy", discId, "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    const draft = JSON.parse(result.stdout);
    expect(draft.id).toMatch(/^disp-/);
    expect(draft.status).toBe("draft");
    expect(draft.discrepancyId).toBe(discId);
    expect(draft.portalTemplate).toContain("Billing discrepancy");
    expect(draft.portalTemplate).toContain("Pax8 billing team");
    expect(draft.filePath).toContain(disputesDir);

    // Draft persisted to disk
    const files = await fs.readdir(disputesDir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("--yes skips the confirmation prompt", async () => {
    // Without -y the command would block on stdin in non-TTY tests, hanging the
    // process. The fact that --yes makes this finish proves the prompt is
    // skipped (the test runner's 15s timeout would catch a regression).
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    const discId = report.discrepancies[0].discrepancyId;

    const result = await runCliExpectSuccess(
      ["invoices", "dispute", "--discrepancy", discId, "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.stderr).not.toContain("File this dispute draft?");
    const draft = JSON.parse(result.stdout);
    expect(draft.status).toBe("draft");
  });

  it("--idempotency-key replays a prior dispute byte-for-byte", async () => {
    const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(auditResult.stdout);
    const discId = report.discrepancies[0].discrepancyId;

    const key = "dispute-idem-1234-4abc-8def-0123456789ab";

    const first = await runCliExpectSuccess(
      [
        "invoices", "dispute",
        "--discrepancy", discId,
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_DISPUTES_DIR: disputesDir, PAX8_IDEMPOTENCY_DIR: idemDir },
    );
    expect(first.stderr).not.toContain("idempotent replay");

    const second = await runCliExpectSuccess(
      [
        "invoices", "dispute",
        "--discrepancy", discId,
        "--yes", "--json",
        "--idempotency-key", key,
      ],
      { PAX8_DISPUTES_DIR: disputesDir, PAX8_IDEMPOTENCY_DIR: idemDir },
    );
    expect(second.stderr).toContain("idempotent replay");
    expect(second.stdout).toBe(first.stdout);

    // Replay must NOT create a second file on disk.
    const files = await fs.readdir(disputesDir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("rejects when no discrepancy or company is provided", async () => {
    const result = await runCliExpectFailure(
      ["invoices", "dispute", "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.stderr).toMatch(/--discrepancy|--company/);
  });

  it("rejects an unknown discrepancy ID", async () => {
    const result = await runCli(
      [
        "invoices", "dispute",
        "--discrepancy", "disc-deadbeef0000",
        "--yes", "--json",
      ],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/No discrepancy matches/);
  });

  it("--help mentions --idempotency-key (write command)", async () => {
    const result = await runCliExpectSuccess(["invoices", "dispute", "--help"]);
    expect(result.stdout).toContain("--idempotency-key");
    expect(result.stdout).toContain("24h TTL");
  });

  it("audit --json surfaces the dispute command in nextActions", async () => {
    const result = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const report = JSON.parse(result.stdout);
    expect(report.nextActions).toBeDefined();
    for (const action of report.nextActions) {
      expect(action.command).toMatch(/^pax8 invoices dispute --discrepancy disc-[a-f0-9]{12}/);
    }
  });

  // The portal template used to hardcode the overcharge remedy ("issue a
  // credit memo") for every discrepancy type, so an undercharge ticket asked
  // billing support for a credit on money the partner actually owes. The
  // pre-fix coverage only asserted two generic strings, which is why it shipped.
  describe("portal template matches the discrepancy direction", () => {
    async function templateFor(type: string): Promise<string> {
      const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
      const report = JSON.parse(auditResult.stdout);
      const row = report.discrepancies.find((d: { type: string }) => d.type === type);
      expect(row, `fixture has no ${type} discrepancy to exercise`).toBeDefined();
      const result = await runCliExpectSuccess(
        ["invoices", "dispute", "--discrepancy", row.discrepancyId, "--yes", "--json"],
        { PAX8_DISPUTES_DIR: disputesDir },
      );
      return JSON.parse(result.stdout).portalTemplate;
    }

    // Assertions reference DISPUTE_COPY rather than literal sentences. The
    // `partnerOwes` wording is pending sign-off (#728); pinning the strings
    // here would make provisional phrasing a contract that a later correction
    // has to break a test to change. What must stay true is the DIRECTION:
    // the impact line and the remedy never disagree.
    it.each([
      ["overcharge"],
      ["unexpected"],
    ])("%s gets the partner-is-owed copy", async (type) => {
      const tpl = await templateFor(type);
      expect(tpl).toContain("overcharge");
      expect(tpl).toContain(DISPUTE_COPY.partnerIsOwed.opening);
      expect(tpl).toContain(DISPUTE_COPY.partnerIsOwed.remedy);
      expect(tpl).not.toContain(DISPUTE_COPY.partnerOwes.remedy);
    });

    it.each([
      ["undercharge"],
      ["missing"],
    ])("%s gets the partner-owes copy", async (type) => {
      const tpl = await templateFor(type);
      expect(tpl).toContain("undercharge");
      expect(tpl).toContain(DISPUTE_COPY.partnerOwes.opening);
      expect(tpl).toContain(DISPUTE_COPY.partnerOwes.remedy);
      // The regression: never serve the credit-memo remedy on money owed.
      expect(tpl).not.toContain(DISPUTE_COPY.partnerIsOwed.remedy);
    });

    it("the two directions never share copy", () => {
      expect(DISPUTE_COPY.partnerIsOwed.remedy).not.toBe(DISPUTE_COPY.partnerOwes.remedy);
      expect(DISPUTE_COPY.partnerIsOwed.opening).not.toBe(DISPUTE_COPY.partnerOwes.opening);
    });

    it("no template ever pairs an undercharge impact line with the owed-to-partner remedy", async () => {
      const auditResult = await runCliExpectSuccess(["invoices", "audit", "--json"]);
      const report = JSON.parse(auditResult.stdout);
      for (const row of report.discrepancies) {
        const result = await runCliExpectSuccess(
          ["invoices", "dispute", "--discrepancy", row.discrepancyId, "--yes", "--json"],
          { PAX8_DISPUTES_DIR: disputesDir },
        );
        const tpl = JSON.parse(result.stdout).portalTemplate;
        if (tpl.includes("undercharge")) {
          expect(tpl, `${row.type} ${row.discrepancyId} contradicts itself`).not.toContain(
            DISPUTE_COPY.partnerIsOwed.remedy,
          );
        }
      }
    });
  });

  // Filing is a write; without a TTY there is nobody to approve it. Before the
  // guard the outcome depended on the shape of stdin rather than on approval:
  // `< /dev/null` wrote nothing only because readline's callback never fired,
  // while a single empty line answered the prompt and confirm(..., {default:
  // true}) mapped "" to yes — so `echo | pax8 invoices dispute --discrepancy X`
  // filed a dispute unapproved, as would any agent harness supplying an empty
  // stdin line. Matches the non-TTY write guards in upgrade.ts,
  // auth/login.ts and recommendations/act.ts.
  describe("non-TTY filing requires --yes", () => {
    async function discId(): Promise<string> {
      const r = await runCliExpectSuccess(["invoices", "audit", "--json"]);
      return JSON.parse(r.stdout).discrepancies[0].discrepancyId;
    }

    it("refuses to file without --yes when stdin is not a TTY", async () => {
      const result = await runCliExpectFailure(
        ["invoices", "dispute", "--discrepancy", await discId(), "--json"],
        { PAX8_DISPUTES_DIR: disputesDir },
      );
      expect(result.stderr).toMatch(/stdin is not a TTY/i);
      const envelope = JSON.parse(result.stderr.slice(result.stderr.indexOf("{")));
      expect(envelope.code).toBe("ERROR_INVALID_INPUT");
    });

    it("writes no draft when it refuses", async () => {
      await runCliExpectFailure(
        ["invoices", "dispute", "--discrepancy", await discId()],
        { PAX8_DISPUTES_DIR: disputesDir },
      );
      const files = await fs.readdir(disputesDir);
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(0);
    });

    it("still files when --yes is passed", async () => {
      const result = await runCliExpectSuccess(
        ["invoices", "dispute", "--discrepancy", await discId(), "--yes", "--json"],
        { PAX8_DISPUTES_DIR: disputesDir },
      );
      expect(JSON.parse(result.stdout).status).toBe("draft");
      const files = await fs.readdir(disputesDir);
      expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    });
  });

  // The terminal framing had the same defect as the portal template: heading,
  // prompt and success line all said "dispute", which reads wrong for an
  // under-billing — you do not dispute your own un-billed usage (#728).
  // Asserted against DISPUTE_COPY so the labels stay renameable.
  describe("terminal framing matches the discrepancy direction", () => {
    async function framingFor(type: string): Promise<string> {
      const audit = await runCliExpectSuccess(["invoices", "audit", "--json"]);
      const row = JSON.parse(audit.stdout).discrepancies.find(
        (d: { type: string }) => d.type === type,
      );
      expect(row, `fixture has no ${type} row`).toBeDefined();
      const r = await runCliExpectSuccess(
        ["invoices", "dispute", "--discrepancy", row.discrepancyId, "--yes"],
        { PAX8_DISPUTES_DIR: disputesDir, PAX8_OUTPUT_FORMAT: "table" },
      );
      return r.stderr;
    }

    it.each([["overcharge"], ["unexpected"]])(
      "%s is framed as the partner-is-owed artifact",
      async (type) => {
        const out = await framingFor(type);
        expect(out).toContain(DISPUTE_COPY.partnerIsOwed.label);
        expect(out).not.toContain(DISPUTE_COPY.partnerOwes.label);
      },
    );

    it.each([["undercharge"], ["missing"]])(
      "%s is framed as the partner-owes artifact",
      async (type) => {
        const out = await framingFor(type);
        expect(out).toContain(DISPUTE_COPY.partnerOwes.label);
        expect(out).not.toContain(DISPUTE_COPY.partnerIsOwed.label);
      },
    );

    it("the two directions never share a label or noun", () => {
      expect(DISPUTE_COPY.partnerIsOwed.label).not.toBe(DISPUTE_COPY.partnerOwes.label);
      expect(DISPUTE_COPY.partnerIsOwed.noun).not.toBe(DISPUTE_COPY.partnerOwes.noun);
    });
  });

  // #733: the closing hint spliced a command and its description with a single
  // space, unlike every other next-step line in the CLI, so it rendered as
  // `pax8 invoices audit re-audit later to confirm resolution` — a command that
  // does not exist.
  it("does not splice the closing hint into a non-existent command (#733)", async () => {
    const audit = await runCliExpectSuccess(["invoices", "audit", "--json"]);
    const discId = JSON.parse(audit.stdout).discrepancies[0].discrepancyId;
    const r = await runCliExpectSuccess(
      ["invoices", "dispute", "--discrepancy", discId, "--yes"],
      { PAX8_DISPUTES_DIR: disputesDir, PAX8_OUTPUT_FORMAT: "table" },
    );
    expect(r.stderr).not.toMatch(/pax8 invoices audit re-audit/);
    // The runnable part must be delimited from the prose that follows it.
    expect(r.stderr).toMatch(/pax8 invoices audit {2,}/);
  });

  // #730: discrepancy IDs are derived from the data that produced them, so an
  // ID minted in demo mode can never match in live. The old message called
  // that staleness and sent the user to re-run the audit, which would keep
  // minting IDs from the same source — it never said which mode it searched.
  it("names the active mode when a discrepancy ID does not match (#730)", async () => {
    const r = await runCliExpectFailure(
      ["invoices", "dispute", "--discrepancy", "disc-000000000000", "--yes", "--json"],
      { PAX8_DISPUTES_DIR: disputesDir },
    );
    const envelope = JSON.parse(r.stderr.slice(r.stderr.indexOf("{")));
    expect(envelope.code).toBe("ERROR_INVALID_INPUT");
    expect(envelope.message).toMatch(/demo data/);
    expect(JSON.stringify(envelope.causes)).toMatch(/live mode will never match/);
    expect(JSON.stringify(envelope.recoverySteps)).toMatch(/demo off/);
  });
});
