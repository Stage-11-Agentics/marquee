# MRQ-107 validation — a real Worker, the real UI, the invited reviewer's own seat

Ran against a local Worker serving the branch build (`wrangler dev --local`, port 8799, seeded with
the shipped demo seed: 9,976 rows, 1,000 submissions, the AIE NYC 2026 conference). `/health`
reported the branch sha each run. Organizer UI driven through the c11 embedded browser; the reviewer
half driven through the credential the UI itself issued.

## The whole loop, as the operator walks it

1. **Landing** — three doors render: `data-demo-role` of `organizer`, `reviewer`, `speaker`.
2. **Reviewer door (before any invite)** — `POST /auth/demo {"role":"reviewer"}` →
   `Dario Quill (per_reviewer-dario-quill)`, **not** the seeded staffer `per_aie-program-committee`
   who also holds `reviewer`. `/auth/me` for that session carries exactly
   `[{event_id: evt_aie-ny-2026, role: reviewer}]`. Their queue is **100 items** — the door opens
   onto real work, so ABS-05/ABS-08 are gradeable rather than a hard fail.
3. **Organizer → /evaluation** — the committee card carries **Invite reviewer** in its header, plus
   "+ Invite a reviewer to this committee" in the body.
4. **Invite dialog** — Name, Email, and eight track checkboxes, each with its track name as its
   accessible name (`checkbox "Security"`, etc.). Filled "Priya Raman /
   priya.raman@example.org", checked **Security**, submitted.
5. **Confirmation** — the form is replaced by: "Priya Raman is on the committee. Reviewing
   Security. The invitation to priya.raman@example.org was logged rather than sent — this
   conference only emails addresses on its allowlist." plus a read-only link field and **Copy
   link**; footer becomes Done / Invite another. The suppression sentence is true: the demo event
   has no `demo_safe_allowlist`, so the consumer would suppress that mail.
6. **Committee card** — `PR Priya Raman · Security · 0 / 200`, beside the three seeded reviewers
   who each carry all eight tracks. Scope is visibly narrower, from the UI alone.
7. **The reviewer's own seat** — took the link the dialog issued (its token, read back out of the
   outbox row it created), exchanged it: `302 → /reviewer`. `/auth/me` → `Priya Raman`,
   memberships `[{evt_aie-ny-2026, reviewer}]`, no staff role.
   **Queue: 19 items, scopes `["Security"]`, round "Initial review"** — the committee's 100
   assignments intersected with her one responsibility. Every queued item carries Security among
   its tracks.
8. **Boundaries** — as Priya, `GET /events/{id}/submissions` → **403**; the organizer register is
   closed to a reviewer seat.

## Elements never jump

Measured `.eval-dialog footer` viewport top across a track toggle in a settled dialog:
`736 → 736` checking, `736 → 736` unchecking; `.scope-checks` height `410 → 410`. Nothing moves
when a control is toggled. The confirmation *replaces* the form rather than growing beneath it, so
the footer buttons are never pushed down a screen by an arriving result.

## A defect this pass caught that the tests did not

The first build wrote invited people with `is_demo = 1` on demo conferences. The live smoke showed
`POST /auth/demo {"role":"reviewer"}` answering with **Priya**, the person just invited, instead of
a seeded persona — because seeded rows carry a frozen future `created_at` and sorted after her. An
organizer inviting a reviewer scoped to a quiet track would have pointed the public reviewer door at
an empty queue. Fixed to `is_demo = 0`, matching every other runtime person writer in the codebase,
and pinned by "an invited reviewer never captures the demo reviewer door".

## Known local-only artifact

`wrangler dev` rewrites the inbound Host to the deployed custom domain, so the on-screen link reads
`https://marquee.stage11.dev/...` locally. The origin comes from `context.req.url`, exactly as the
shipped `requestMagicLink` builds it, so a deployed Worker emits its own origin. Verified by
exchanging the same token against the local origin.

## Gate

`npm run pr-gate -- --ticket MRQ-107` → **pass**, 59.8s of a 120s budget (`0bf998a`).
