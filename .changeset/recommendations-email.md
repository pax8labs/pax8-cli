---
"@pax8/cli": patch
---

New `pax8 recommendations email <n>` — draft a customer-ready email for a specific recommendation and hand off to the partner's default mail client.

UXR F3 (#658): partners described an observed workflow (export recs → paste into Copilot → generate a customer email) and Josh's response was *"why don't we just generate the email?"* The CLI generates the draft — subject, body, and a `mailto:` URL — and hands off. **The CLI never sends.** The partner (or their mail client) is the sender-of-record.

**Surface:**

```
pax8 recommendations email 1                       # print draft + mailto hint
pax8 recommendations email 1 --json                # structured envelope
pax8 recommendations email 1 --mailto              # single-line URL, pipeable
pax8 recommendations email 1 --to alice@x.com --mailto
pax8 recommendations email 1 --open                # spawn OS-native URL opener
```

Two template variants — one for seat-gap recs (framed around coverage) and one for cross-sell recs (framed around the missing category). Both draw from the existing engine fields shipped alongside the rationale drill-down (`reason`, `rationaleSnippet`, `title`, `estimatedMrrUplift`, `targetSeats`, `companyName`). Both end with a `<partner name>` placeholder — v1 doesn't plumb operator identity through.

`--open` uses the existing cross-platform `openUrl()` helper (`open` / `xdg-open` / `start`), and the affordance always prints the URL first so a headless SSH session or missing default handler still leaves the partner with something to copy.

Closes #658.
