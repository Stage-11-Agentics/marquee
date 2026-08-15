# MRQ-222: Airtable, agent-native: SKILL.md chapter, setup guide, and CLI connect verbs

Make connecting Airtable something an agent can do, and something a reader of the docs finds. **Depends on MRQ-221**, which builds the connect API this documents and exercises.

`PHILOSOPHY.md` says agent-native by design: agents are first-class operators, the API is real, and the CLI and skill file ship. An organizer who runs their conference through an agent must be able to connect Airtable the same way an organizer with a browser can — and today neither can, because there is no connect flow at all (see MRQ-221 for that finding).

## Contract

- **`SPEC.md` Amendment 25**, the Discovery section and the §4.2 route table.
- **`sequence/USER_STORIES.md` Amendment 25** — US-92, specifically **AC-312** and **AC-313**.
- **`EVALUATION.md` §2.8** for how those two are verified.

## Scope

1. **`SKILL.md`** gains an Airtable chapter: what the mirror is, what it is not (D1 stays the source of truth; Airtable is never read on a request path), how to connect it, how to read status, how to disconnect. `SKILL.md` is generated — follow the existing generation path rather than hand-editing the artifact, exactly as `AC-307` required for `marquee event delete`.
2. **The setup guide** (`docs/GETTING-STARTED.md`) gains the same flow in the organizer's language, placed as an optional step — a Marquee with no Airtable is a complete Marquee, and the chapter must not read as though something is missing without it.
3. **CLI verbs** on the `marquee` CLI covering connect, status, and disconnect, dispatching to MRQ-221's routes. **Do not implement a second code path** — the CLI calls the API, as `AC-307` established for conference deletion.
4. **AC-313's scoping** proven from the agent side: connect and disconnect require `mirror:write`, status is readable under a read scope, and no scope returns the token. The `mirror:write` scope already exists (`src/api/grants.ts`, `src/lib/auth/scope-resolution.ts`) and already appears in the API-token picker (`src/ui/settings/ApiTokensPage.tsx:16`) — where it has been offering a scope for a feature with no other surface. This ticket is what makes that entry mean something.
5. **AC-312's real assertion**: an agent completes connect → verify → map → confirm a change reaching the fake provider, **with no screen opened**. That is a test, not a doc claim.

## Do not

- Do not hand-edit generated `SKILL.md` output.
- Do not build the settings screen, the connect endpoints, or `mirror_credentials` — all MRQ-221.
- Do not add a second transport or import the Airtable client outside `src/jobs/mirror/*` (`scripts/checks/check-mirror-imports.mjs` will fail you).
- Do not edit contract docs or mint AC IDs.
