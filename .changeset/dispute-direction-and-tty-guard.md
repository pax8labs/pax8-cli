---
"@pax8/cli": patch
---

fix(dispute): match `invoices dispute` output to the discrepancy direction, and refuse to file off-TTY (#728)

**Every user-facing surface of `invoices dispute` assumed an overcharge.** Discrepancy types split into "Pax8 owes the partner" (`overcharge`, `unexpected`) and "the partner owes Pax8" (`undercharge`, `missing`), and only the first was ever exercised. The generated portal ticket derived its impact label from the finding but hardcoded the closing remedy, so an under-billing produced a ticket reading `$2,400.00 undercharge` … `issue a credit memo` — asking Pax8 billing support for a credit on money the partner owes. The demo fixture is 9 of 12 the partner-owes direction, so most generated tickets contradicted themselves. The terminal framing had the same defect: heading, prompt, spinner and success line all said "dispute", and you do not dispute your own un-billed usage.

All of this copy now lives in one `DISPUTE_COPY` object keyed by direction, selected by a single classifier shared with the impact label, so the label, the ticket and the terminal framing cannot disagree again. The partner-owes wording is deliberately non-prescriptive — it names no remedy mechanism and asks Pax8 to name one, rather than asserting billing process in a partner-facing artifact.

Direction is derived from the discrepancy `type`, not the sign of `dollarImpact`. The sign is correct for every row the auditor currently emits but is a proxy: a zero-impact row (a zero-priced SKU — a free add-on or a $0 trial — that is mis-invoiced) is not `> 0`, so a zero-dollar `overcharge` would have been framed as an under-billing report.

**BEHAVIOR CHANGE — non-interactive `invoices dispute` now requires `--yes`.** Filing is a write, but whether it proceeded unconfirmed depended on the shape of stdin rather than on approval: `< /dev/null` wrote nothing only because readline hit EOF and the prompt's callback never fired, while a single empty line answered the prompt and `confirm(…, { default: true })` mapped `""` to yes. So `echo | pax8 invoices dispute --discrepancy X` filed a dispute with no approval, as would any agent harness handing a command an empty stdin line — and the `/dev/null` case looked like a gate while not being one.

It now fails closed with `ERROR_INVALID_INPUT`, matching the existing non-TTY write guards in `upgrade.ts`, `auth/login.ts` and `recommendations/act.ts`. **Automation that relied on the old behavior will break**; the migration is one flag — pass `--yes` (or set `PAX8_YES=1`) to file without prompting, which the error's recovery steps name directly. Interactive use is unchanged.
