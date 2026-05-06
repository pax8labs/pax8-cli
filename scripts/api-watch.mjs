// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// scripts/api-watch.mjs
//
// Scheduled API drift watcher — Layer 1 of the api-resilience plan (#176).
//
// Queries PostHog for spikes in ERROR_API_VALIDATION events grouped by
// command over the last 24 hours. When a bucket exceeds the configured
// threshold, opens a maintainer issue on GitHub (or comments on the
// existing open issue if one was already opened within the last 7 days).
//
// Usage:
//   node scripts/api-watch.mjs                  # normal run
//   WATCH_DRY_RUN=1 node scripts/api-watch.mjs  # dry-run: logs intent, no API calls
//
// Required env vars (provided by the workflow):
//   POSTHOG_PROJECT_API_KEY   Pax8-owned PostHog personal/project API key (read scope)
//   POSTHOG_HOST              e.g. https://us.i.posthog.com
//   GITHUB_TOKEN              Workflow token with issues: write
//   REPO                      e.g. pax8labs/pax8-cli
//
// Optional env vars (tunable thresholds):
//   THRESHOLD_USERS           Open issue if distinct users >= this value (default: 5)
//   THRESHOLD_EVENTS          Open issue if total events >= this value (default: 20)
//   WATCH_DRY_RUN             Set to "1" to skip PostHog + GitHub calls; log intent only

const DRY_RUN = process.env.WATCH_DRY_RUN === "1";
const POSTHOG_KEY = process.env.POSTHOG_PROJECT_API_KEY;
const POSTHOG_HOST = (process.env.POSTHOG_HOST ?? "https://us.i.posthog.com").replace(/\/$/, "");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO ?? "";
const THRESHOLD_USERS = parseInt(process.env.THRESHOLD_USERS ?? "5", 10);
const THRESHOLD_EVENTS = parseInt(process.env.THRESHOLD_EVENTS ?? "20", 10);

// ── guard: secret not provisioned yet ──────────────────────────────────────

if (!POSTHOG_KEY) {
  console.log("[api-watch] POSTHOG_PROJECT_API_KEY is not set — skipping run.");
  console.log("[api-watch] Once the org admin adds the secret, this workflow will activate.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("[api-watch] DRY_RUN=1 — will log intent without calling PostHog or GitHub.");
}

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Derive the PostHog project numeric ID from the personal API key.
 * PostHog personal API keys encode the project: the Query API path requires
 * the numeric project_id. We discover it via GET /api/projects/ using the key.
 */
async function getProjectId() {
  if (DRY_RUN) {
    console.log("[api-watch] DRY_RUN: would call GET /api/projects/ to discover project_id");
    return "DRY_RUN_PROJECT_ID";
  }

  const res = await fetch(`${POSTHOG_HOST}/api/projects/`, {
    headers: { Authorization: `Bearer ${POSTHOG_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`PostHog /api/projects/ returned ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  // Response is { results: [{ id, name, ... }, ...] }
  const projects = body.results ?? body;
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("PostHog returned no projects for this key. Check that POSTHOG_PROJECT_API_KEY has the correct scope.");
  }

  // Use the first project (Pax8-owned key should be scoped to exactly one project).
  const id = projects[0].id;
  console.log(`[api-watch] Using PostHog project: ${projects[0].name} (id=${id})`);
  return id;
}

/**
 * Query PostHog for ERROR_API_VALIDATION events in the last 24 hours,
 * grouped by command. Returns an array of bucket objects:
 *   { command, count, distinct_users, cli_versions }
 *
 * Uses the HogQL Query API (POST /api/projects/<id>/query/).
 * HogQL is PostHog's SQL-like query language; it surfaces the same
 * properties captured by the SDK (event properties live under "properties").
 */
async function queryPostHog(projectId) {
  // Window: last 24 hours expressed as a HogQL relative date.
  const hogql = `
    SELECT
      properties.command                         AS command,
      count()                                    AS total_events,
      count(DISTINCT distinct_id)                AS distinct_users,
      arrayStringConcat(
        arrayDistinct(
          groupArray(properties.cli_version)
        ),
        ', '
      )                                          AS cli_versions
    FROM events
    WHERE event = 'command_executed'
      AND properties.success = false
      AND properties.error_code = 'ERROR_API_VALIDATION'
      AND timestamp >= now() - INTERVAL 24 HOUR
    GROUP BY properties.command
    ORDER BY total_events DESC
  `.trim();

  if (DRY_RUN) {
    console.log("[api-watch] DRY_RUN: would POST the following HogQL query to PostHog:");
    console.log(hogql);
    // Return a synthetic spike so dry-run exercises the downstream logic.
    return [
      {
        command: "subscriptions",
        count: 42,
        distinct_users: 7,
        cli_versions: "0.1.0, 0.1.1",
      },
    ];
  }

  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${POSTHOG_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostHog query API returned ${res.status}: ${text}`);
  }

  const body = await res.json();

  // HogQL query responses: { results: [[col0, col1, ...], ...], columns: [...] }
  const rows = body.results ?? [];
  return rows.map(([command, total_events, distinct_users, cli_versions]) => ({
    command: command ?? "(unknown)",
    count: Number(total_events ?? 0),
    distinct_users: Number(distinct_users ?? 0),
    cli_versions: cli_versions ?? "",
  }));
}

// ── GitHub helpers ─────────────────────────────────────────────────────────

const [REPO_OWNER, REPO_NAME] = REPO.split("/");
const GH_API = "https://api.github.com";

function ghHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Search for open issues with label "api-drift" and a title containing the
 * given command name, created within the last 7 days. Returns the first match
 * or null.
 */
async function findExistingIssue(command) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const q = `repo:${REPO} is:issue is:open label:api-drift "${command}" in:title created:>=${since.slice(0, 10)}`;
  const url = `${GH_API}/search/issues?q=${encodeURIComponent(q)}&per_page=1`;

  if (DRY_RUN) {
    console.log(`[api-watch] DRY_RUN: would search GitHub issues with query: ${q}`);
    return null;
  }

  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) {
    console.warn(`[api-watch] GitHub search returned ${res.status} — treating as no existing issue`);
    return null;
  }
  const body = await res.json();
  return body.items?.[0] ?? null;
}

/**
 * Open a new GitHub issue for the given bucket. Returns the issue URL.
 */
async function openIssue({ command, count, distinct_users, cli_versions }) {
  const title = `api-drift: ERROR_API_VALIDATION spike on \`${command}\``;
  const body = buildIssueBody({ command, count, distinct_users, cli_versions });
  const labels = ["api-drift", "priority: high", "bug"];

  if (DRY_RUN) {
    console.log(`[api-watch] DRY_RUN: would open issue "${title}" with labels: ${labels.join(", ")}`);
    console.log("[api-watch] DRY_RUN: issue body:");
    console.log(body);
    return "(dry-run — no issue opened)";
  }

  const res = await fetch(`${GH_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
    method: "POST",
    headers: ghHeaders(),
    body: JSON.stringify({ title, body, labels }),
  });

  if (!res.ok) {
    throw new Error(`GitHub create-issue returned ${res.status}: ${await res.text()}`);
  }

  const issue = await res.json();
  return issue.html_url;
}

/**
 * Post an update comment on an existing issue. Returns the comment URL.
 */
async function commentOnIssue(issueNumber, { command, count, distinct_users, cli_versions }) {
  const commentBody = [
    `**Spike persists** — updated counts from the last 24 h:`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Total events | **${count}** |`,
    `| Distinct users | **${distinct_users}** |`,
    `| CLI versions hit | ${cli_versions || "—"} |`,
    ``,
    `_Auto-comment from the API drift watcher. Tracking: closes when a fix lands._`,
  ].join("\n");

  if (DRY_RUN) {
    console.log(`[api-watch] DRY_RUN: would comment on issue #${issueNumber} for command "${command}"`);
    return "(dry-run — no comment posted)";
  }

  const res = await fetch(
    `${GH_API}/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ body: commentBody }),
    },
  );

  if (!res.ok) {
    throw new Error(`GitHub create-comment returned ${res.status}: ${await res.text()}`);
  }

  const comment = await res.json();
  return comment.html_url;
}

function buildIssueBody({ command, count, distinct_users, cli_versions }) {
  return [
    `## Suspected API drift on \`${command}\``,
    ``,
    `In the last 24h:`,
    `- **${count}** events emitting \`error_code: ERROR_API_VALIDATION\``,
    `- **${distinct_users}** distinct users affected`,
    `- CLI versions hit: ${cli_versions || "—"}`,
    ``,
    `## Next step`,
    ``,
    `Hit the underlying endpoint manually, compare the response against the schema in \`packages/core/src/api/types.ts\`, and decide whether to:`,
    ``,
    `- Add an optional field (additive — patch bump)`,
    `- Narrow / widen a type (consumer-visible — minor bump)`,
    `- Migrate (breaking — major bump, deprecation cycle)`,
    ``,
    `Tracking: closes when a fix lands; auto-comments if the spike persists.`,
    ``,
    `---`,
    `_Auto-opened by the API drift watcher ([.github/workflows/api-watch.yml](../../blob/main/.github/workflows/api-watch.yml)). Refs #176._`,
  ].join("\n");
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[api-watch] Starting — thresholds: users>=${THRESHOLD_USERS}, events>=${THRESHOLD_EVENTS}`);

  let projectId;
  try {
    projectId = await getProjectId();
  } catch (err) {
    console.error(`[api-watch] Failed to resolve PostHog project ID: ${err.message}`);
    // Rate-limit or transient error — exit 0 so the workflow doesn't alert falsely.
    process.exit(0);
  }

  let buckets;
  try {
    buckets = await queryPostHog(projectId);
  } catch (err) {
    console.error(`[api-watch] PostHog query failed: ${err.message}`);
    // Transient error — degrade gracefully.
    process.exit(0);
  }

  console.log(`[api-watch] Query returned ${buckets.length} command bucket(s).`);

  if (buckets.length === 0) {
    console.log("[api-watch] No ERROR_API_VALIDATION events in the last 24 hours. All clear.");
    process.exit(0);
  }

  for (const bucket of buckets) {
    const { command, count, distinct_users, cli_versions } = bucket;
    const meetsThreshold = distinct_users >= THRESHOLD_USERS || count >= THRESHOLD_EVENTS;

    console.log(
      `[api-watch] command="${command}" events=${count} distinct_users=${distinct_users} versions="${cli_versions}" — threshold_met=${meetsThreshold}`,
    );

    if (!meetsThreshold) continue;

    // Dedup: look for an existing open issue in the last 7 days.
    let existingIssue = null;
    try {
      existingIssue = await findExistingIssue(command);
    } catch (err) {
      console.warn(`[api-watch] Could not check for existing issue: ${err.message} — will open a new one`);
    }

    if (existingIssue) {
      console.log(`[api-watch] Found existing issue #${existingIssue.number}: ${existingIssue.html_url}`);
      try {
        const commentUrl = await commentOnIssue(existingIssue.number, bucket);
        console.log(`[api-watch] Commented with updated counts: ${commentUrl}`);
      } catch (err) {
        console.error(`[api-watch] Failed to post comment on #${existingIssue.number}: ${err.message}`);
      }
    } else {
      try {
        const issueUrl = await openIssue(bucket);
        console.log(`[api-watch] Opened new issue: ${issueUrl}`);
      } catch (err) {
        console.error(`[api-watch] Failed to open issue for command "${command}": ${err.message}`);
      }
    }
  }

  console.log("[api-watch] Done.");
}

main().catch((err) => {
  console.error(`[api-watch] Unexpected error: ${err.message}`);
  // Unexpected errors exit 0 so a transient problem does not page the team
  // before the secret is even provisioned. Revisit once the watcher is live.
  process.exit(0);
});
