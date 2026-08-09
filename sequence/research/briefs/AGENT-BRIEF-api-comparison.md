# Mission: API Comparison — Marquee vs Sessionboard

You are the **API comparison analyst** for Marquee (open-source Sessionboard replacement; competition deadline Wed 2026-08-12 22:00 PT). Sessionboard publishes API docs at **https://sessionboard.mintlify.app/introduction** — crawl them thoroughly (follow the sidebar: every endpoint group, auth, pagination, webhooks, rate limits, errors). Compare against the API Marquee plans to build, and tell the orchestrator what to change while change is still free: the build fleet kicks off within hours.

## Read ours first

1. `SPEC.md` — the API surface section (REST routes, auth scopes, public/authed/admin) and §5.13's API docs + tokens screens; also the `marquee` CLI command list.
2. `sequence/USER_STORIES.md` — US-68 (API), US-69 (CLI), US-70 (SKILL.md), and their ACs (AC-105–108, AC-138–144 area — verify exact IDs from the file).
3. `EVALUATION.md` §1.1 — `check:api` asserts route-manifest parity: every UI action must exist in the public schema.
4. `PHILOSOPHY.md` principle 3 — agent-native: the UI rides on the API; nothing UI-only. Context: the API is an **explicit bonus in the competition brief (R53)**.

## Deliverable

`sequence/research/api-comparison.md`:

- **Their API, mapped:** resource groups, endpoints, auth model, pagination, rate limits, webhooks, anything notable (versioning, expansion, filtering). Verbatim-quote sparingly, cite every page URL.
- **Coverage matrix:** their endpoints × our planned routes. Mark: WE COVER / WE LACK / THEY LACK (things our API does that theirs doesn't — e.g., agent-driven workflows, bulk accept, board transitions, mirror status).
- **Gap calls, ranked:** for each WE LACK, is it (a) needed for the competition (judges may compare APIs — R53 is a named bonus), (b) cheap and worth adding, or (c) rightly skipped (CRM/marketing scope, etc.)? Recommend concretely: route + verb + one-line semantics.
- **Design wins to steal or beat:** naming conventions, webhook payload shapes, anything their docs do well or badly (their docs ARE a judge-visible comparable for ours).
- **Verdict:** ≤10 lines — what SPEC should amend before kickoff, if anything.

Work fast: first pass ≤ 90 minutes. When done: `c11 send --workspace workspace:16 --surface surface:128 "API Comparison: done — <verdict one-liner; N gaps recommended, N skipped>. File: sequence/research/api-comparison.md"` — the c11 send is your completion signal, do not rely on printing to your own terminal. Stay alive for follow-ups.
