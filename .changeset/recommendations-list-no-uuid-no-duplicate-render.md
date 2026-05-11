---
"@pax8/cli": patch
---

Fix: `pax8 recommendations list` no longer leaks raw product IDs into human (table) output and no longer renders the same recommendation list twice. The "Quick actions" block — a per-rec `orders create --company "<name>" --product <uuid> --quantity <n>` snippet that re-printed every visible recommendation and exposed the product UUID in non-JSON output — has been replaced with a single one-line summary (`Top N alone capture $X/mo.`). The table above is the menu, and the existing one-line `promptNextSteps` drill-in hint stays unchanged. JSON output is untouched: every `recommendation.orderCommand` still includes the full `--product <id>` form so agents and downstream tooling can execute it verbatim. Closes #195.

Also adds a `PAX8_OUTPUT_FORMAT` env-var escape hatch (`table` | `json` | `csv` | `quiet`) in `getOutputFormat` so subprocess tests can exercise the human-render code path — without it the non-TTY auto-fallback to JSON makes table-mode regressions like this one impossible to assert from a piped child process.
