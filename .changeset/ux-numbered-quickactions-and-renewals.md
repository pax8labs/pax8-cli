---
"@pax8/cli": patch
---

UX: `pax8 dashboard` Quick Actions and `pax8 subscriptions renewals` "Try next:" now render the numbered list before the drill-in prompt. Previously the dashboard printed "Quick Actions" then prompted "Type 1-5" with no visible 1-5 menu (the rows had been built internally but never rendered). The renewals "Try next:" block was static text with no interactive affordance. Both now share the same numbered + pickable pattern via `promptNextSteps({ renderList: true })`. Callers that already print a numbered table above the prompt (`recommendations list`, `companies list`, etc.) keep their existing headless behavior — the `renderList` flag is opt-in. The `subscriptions update <id> --quantity <n>` advisory in renewals remains as informational text below the pickable list since its placeholder argument can't be drilled into interactively.
