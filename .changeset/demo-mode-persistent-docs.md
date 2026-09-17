---
"@pax8/cli": patch
---

docs: teach `pax8 init --demo` instead of a per-command `PAX8_DEMO=1` prefix (#737)

The README taught demo mode as an inline prefix. That prefix applies to **one command**, and forgetting it on the next one doesn't error — it silently runs against live data. The only signal you left demo mode is the *absence* of the `✨ Demo mode` banner. This already caused a live-mode command during hands-on testing.

The README now leads with `pax8 init --demo`, which persists, and keeps `PAX8_DEMO=1 pax8 <cmd>` as the documented one-shot / CI form with its single-command scope stated explicitly. `pax8 demo status` and `pax8 demo off` are surfaced alongside it, since "which mode am I in?" is the question the banner answers badly.

**The agent-facing docs keep the prefix, deliberately.** `pax8 init --demo` is a write — it changes whether every later command reaches the live API — so instructing an agent to run it would contradict the safety contract in the same file that defines it. `skill.md` and `AGENTS.md` instead make the per-invocation scope explicit, say why it matters (a call that loses the prefix runs against the partner's live account, where `orders create` spends real money), point at `pax8 demo status` as the direct answer rather than inferring from a banner that's easy to miss in a transcript, and mark persistent demo mode as something to suggest rather than run.

Docs only — no behaviour change. `skill.md` ships inside the package as of #720, so this rides out with the next release.
