# Plan Review: MRQ-166

### 1. Verdict

**PASS** — Plan is complete, feasible, and aligned. Implementation can proceed.

### 2. Summary

Reviewed the plan against the current `src/lib/sessionize-import.ts`, `src/routes/imports.routes.ts`, and `src/ui/import/SessionizeImportPage.tsx`, plus the existing test suite (`tests/integration/api/sessionize-import.AC-110-113.test.ts` and fixtures) and the MRQ-164 precedent it cites. The plan is unusually precise — it quotes the exact lines it will touch, correctly identifies that no test/fixture depends on the `@example.invalid` speaker placeholder, and its five scope items compose into a coherent, minimal fix that mirrors MRQ-164's established pattern (with a deliberate, well-justified divergence: name-matched rows never touch email, vs. MRQ-164's last-write-wins for bio/title/company). The one real gap is that `personByName` — the function item 4 targets — has a second call site (`speakerForToken`, used to resolve a session's `speaker_emails` tokens) that the plan doesn't mention; the same "arbitrary human" bug class it's closing on the speaker-import path can still occur there if the ambiguity-decline logic isn't applied to both callers.

### 3. Issues

```
**[MAJOR] Scope item 4 — personByName has two call sites, only one is named**
`personByName` is called from `importSpeaker` (src/lib/sessionize-import.ts:473) AND from
`speakerForToken` (src/lib/sessionize-import.ts:570-574), which resolves each token in a
session row's `speaker_emails` column when the token isn't an email. If a session CSV
references a speaker by bare name and two people share that name, today's `LIMIT 1` query
silently attaches the wrong person as submitter/co-speaker to that session — the same
"arbitrary human" failure class the ticket exists to close, just surfacing on the session
side instead of the speaker-record side. The plan only discusses the effect on the speaker
row (item 4's example, the acceptance criterion "A name that matches two people matches
neither"); it doesn't say what an ambiguous match should do when called from
speakerForToken (presumably: treat as no match, which then feeds into the existing
"at least one speaker email or name must match" check on line 674 and fails the session row).
**Recommendation:** Have the plan state explicitly that both call sites share the
ambiguity-decline behavior, and add a test that exercises the ambiguous case through a
session row's speaker_emails column (name token, two same-named people), not just through
the speaker CSV directly.
```

```
**[MINOR] Acceptance criteria — cascading session failures aren't mentioned**
Once a speaker row fails (missing email), that speaker is never added to `speakerMap`
(src/lib/sessionize-import.ts:887-889 only runs on success). Any session row whose
`speaker_emails` depends solely on that failed speaker will now also fail, via "at least
one speaker email or name must match the speakers export" (line 674) — a reason that
doesn't obviously point back to the real root cause (a blank email cell on the speaker
export). This is very likely the *correct* behavior (a session with no real speaker
shouldn't succeed either), but the plan's acceptance criteria ("the other rows in the
same import still succeed") don't say so, which risks it reading as a surprise regression
during code review rather than an intended consequence.
**Recommendation:** Add a line to Acceptance making the cascading session failure explicit
and expected, and cover it with a test (fixture: one speaker with blank email referenced
by one session's speaker_emails).
```

```
**[MINOR] Scope item 1 — framing slightly overstates the current gap**
"There is no required-field enforcement there today" is true of the backend
(`normalizeMapping`), but `src/ui/import/SessionizeImportPage.tsx:86-93` already computes
`requiredSpeakers = ["name", "email"]` and disables the "Map, import, and review" button
when email is unmapped — client-side only, and not a substitute for the server-side check
this item correctly adds (an API caller can bypass it), but worth the implementer knowing
so the two checks aren't duplicated with inconsistent messages. Separately: the server-side
mapping refusal only fires if `/mapping` is actually called before `/run` — a caller could
upload and go straight to `/run` on the initial auto-detected mapping. That's not a data-
integrity gap (item 2's per-row check is the real backstop and fires unconditionally, since
an unmapped email column makes every row's email cell read as empty), just worth knowing the
mapping-step refusal is a fail-fast UX nicety layered on top of the row-level guarantee, not
the primary defense.
**Recommendation:** No plan change required; note for the implementer only.
```

### 4. Positive Observations

- The plan cites exact line numbers and existing precedent (`if (!name) throw new Error(...)`) rather than describing the change abstractly — it's clear the author read the actual code, not just the bug report.
- Correctly verified (and it holds up) that nothing depends on the `@example.invalid` speaker placeholder before proposing its deletion — no test, fixture, or seed references it (confirmed: only the unrelated `unattributed+...@example.invalid` reviewer placeholder and two unrelated git-config test emails match that string in the repo).
- Item 5 (name-matched rows never rewrite email) is a deliberate, well-reasoned divergence from MRQ-164's last-write-wins pattern, and the plan states *why* rather than just asserting it — this is exactly the kind of judgment call a reviewer needs justified, not just declared.
- Explicitly scopes out the case-insensitive-email uniqueness bug as its own ticket rather than scope-creeping into a real but orthogonal latent issue — good boundary discipline.
- "Before shipping" flags a real production-data risk (existing `@example.invalid` rows) that a stricter import might otherwise surface as user-facing breakage, and correctly treats it as an operational check rather than smuggling in a data migration.
- Explicitly preserves the unrelated *unattributed reviewer* placeholder (line 607) and gives the reason it's a genuinely different case — shows the plan considered adjacent code before deciding what not to touch.
