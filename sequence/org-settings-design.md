# Organization settings — design interview record

Interview: Atin + org-settings design surface, 2026-08-14. Prototype-only round —
this document records the rulings, the surface's information architecture, and
the scope of the prototype mock. No build/src changes ride on it; AC IDs are
minted at consolidation, never here.

**Why this surface exists.** Conference settings contains nothing about who can
log in. The machinery already exists in the contract — SPEC Amendment 19's org
members, one-time invite links, instance status, `memberships` with roles and a
nullable `event_id` — but it only surfaces during the cold-start setup walk
(rulings D1–D8, `prototypes/cold-start/DECISIONS.md`). Access management had no
steady-state home. This is that home.

**Standing constraint (not relitigated):** invite-only. No request-to-join or
approval queue.

---

## Rulings (Atin, 2026-08-14)

### O1 — Organization settings is its own surface; the nav row closes the Organization group

The sidebar's Organization group becomes **People CRM · Outreach · Settings**
(labels per the CRM prototype's 2026-08-14 state). ⚙ Settings as the last row
mirrors how the conference group ends in its own Settings row; the ruled
label-shortening convention ("labels shortened by their group label",
sidebar-reorg R-notes) makes the two Settings rows unambiguous, and the
symmetry teaches the org/conference two-level model for free.

### O2 — Four tabs; API tokens moves up from Conference settings

Organization settings tabs: **Organization · Organizers · Instance · API
tokens**.

- **API tokens moves here** because `api_tokens` is an org-scoped table
  (`org_id`, *nullable* `event_id`) and `POST /org/tokens` already accepts
  `event_ids[]` — a token that can span conferences never belonged under one
  conference. Conference settings loses the tab.
- **Webhooks and Airtable stay in Conference settings** — `webhook_endpoints`
  and the mirror are genuinely `event_id`-scoped.
- Conference settings after the move: Conference · Venues · Task templates ·
  Airtable · Webhooks.

### O3 — Firing an organizer: one dialog, one transaction

Removing an organizer is a single confirmed action with everything it touches
listed before commit.

**Dies immediately (one transaction):**
- Every membership they hold — org-wide and event-scoped alike.
- All their `auth_sessions` (already contract: SPEC Amendment 19 §3.2, same
  transaction) and any unexpired login-purpose magic links.

**Decided in the dialog:**
- **API tokens they minted** (`created_by`): listed with per-token checkboxes,
  **default checked = revoke**. A fired volunteer knows those token values, but
  some may power live integrations the org keeps — show-and-choose, revoke as
  the default.
- **Open review assignments / task ownership**: the dialog *states the count*
  ("3 unfinished review assignments return to the unassigned pool");
  reassignment happens afterward on the evaluation screen, never crammed into
  the firing dialog.

**Survives untouched:** the `people` row, every attributed action, submitted
evaluations, the audit trail. History is immutable; attribution keeps the name.

**The seat trap, designed around explicitly:** people are org-scoped, so the
same person can hold an organizer seat *and* a speaker seat. Removing the
organizer seat never touches speaker participations, and when the person holds
both, the dialog says so.

Existing guardrail kept: the last remaining `owner` membership is undeletable,
server-enforced.

### O4 — Day-of onboarding: QR + short code on the invite; `ops` scoped to the event

The one-time invite link is mail-independent by design (D7); day-of it must
also cross a hostile venue network. The invite modal gains:

- **QR code** rendered beside the copyable URL — organizer shows a phone
  screen, the volunteer scans on cellular.
- **Short join code** — a readable form of the same one-time link
  (`…/join/BLUE-FALCON`), speakable across a registration desk when even
  scanning fails. Single-use with expiry, so guessability is a non-issue.
- **Role** and **Scope** fields. Scope ∈ whole organization / this conference
  only — `memberships.event_id` already models it. A day-of volunteer gets
  **`ops` scoped to this conference**: no new role invented; the existing
  vocabulary (`owner | program_lead | ops | reviewer | speaker`) already has
  the right word. After the event, the O3 removal flow retires the seat.

### O5 — Removing a speaker is not an org-settings concern; three acts, three homes

Organization settings governs organizer seats only. Speaker-side removal is
three distinct acts:

1. **Un-accepting a talk** — the existing reversal cascade on the record
   (2026-08-10 rulings: task cancellation via `cancelled_at`, the
   `Cancel open tasks` / `Keep tasks active` dialog, idempotent
   `reconcileTaskSet`, re-acceptance restores). Unchanged.
2. **Removing the person from the conference entirely** ("we no longer want
   this speaker affiliated with our event") — a new **Remove from this
   conference** action on the person's record (their event-participation view).
   One dialog listing everything it touches before commit:
   - Ends **every participation** they hold at this event — speaker,
     co-speaker, moderator, all roles, across all sessions.
   - **Cancels their open tasks** (existing `cancelled_at` machinery — finished
     work stays finished).
   - **Revokes event access**: portal sessions, unexpired magic links, task
     links.
   - **Survives**: the CRM row, their submissions (record history), everything
     attributed.
   - **Published sessions — ruled option (a):** a published session they're on
     **stays published with the speaker removed from its public listing**, and
     the agenda slot is kept (consistent with the standing "reversal does not
     free the agenda slot" behavior). The dialog carries a **clear, loud
     warning** naming each affected published session — and it **must call out
     when the person is the only speaker** on a talk/session/abstract, since
     removal leaves that session speakerless on the public site.
3. **Revoking portal access alone** (misconduct case) — an explicit action on
   the person killing sessions + magic links + task links without touching
   participation or history.

### O6 — Person-delete exists, as a CRM action

Deleting a `people` row is real — for duplicates and spam — but it is a
**People-area (CRM) action**, not org settings. Recorded here as a boundary;
its design belongs to the People/CRM scoping work (`prototypes/crm/`), where it
lives next to merge-duplicates.

### O7 — The Organization tab's contents

- **Organization name** (org profile).
- **Default timezone** — seeds the timezone field when creating a new
  conference; each conference still owns its own.
- **Default theme** — the org-wide default appearance a user gets before they
  choose; **per-user override persists** (today's localStorage choice wins once
  made). The picker offers the real production five (O8).
- **Communication defaults** *(mocked to be judged — Atin intrigued, not
  ruled)*: from-name and reply-to that new conferences inherit. The *mechanics*
  of mail (Resend, sender verification) stay on the Instance tab; this is only
  the voice.
- **Branding** *(mocked to be judged — same status)*: org logo + accent color,
  inherited as the default by every new conference; the existing per-conference
  logo field becomes the override.
- **Remove demo data** — the D3/AC-286 one-action removal, relocated to its
  steady-state home.

Either mocked card gets struck in the drive-through if it doesn't earn its
place.

### O8 — Themes: the prototype matches production

Production (`src/ui/shell/theme.ts`) ships **five** themes: **Marquee Light**
(`day`), **Marquee Night** (`night`) — palette themes — and three register
themes: **latent.space**, **AI Engineer**, **swyxy** (lowercase deliberate,
judge-facing; swyxy carries its own internal light/dark mode). The pipeline
prototype's theme registry (v1.12/MRQ-103) has only Day/Night under
prototype-only labels. Ruling: **update the prototype to match production** —
five entries, production labels — and the org-settings default-theme picker
lists the same five.

---

## Information architecture

```
Organization settings            (route: #org — tabs like conference settingsTabs)
├── Organization
│     Org name · Default timezone · Default theme (5)
│     Communication defaults [judged] · Branding [judged]
│     Remove demo data
├── Organizers
│     Member list: name · email · role chip (Owner highlighted, "you" chip)
│       · scope (Organization / <conference name>) · Remove (O3 dialog)
│     Pending invites: minted date · role+scope · expiry · Revoke
│     + Invite additional organizer → modal:
│       Role (program_lead / ops / reviewer) · Scope (org / this conference)
│       → link + QR + short join code, single-use, 7-day expiry
├── Instance
│     The D8 panel as steady state: Mail · Uploads · Spam protection · Domain
│     each honestly configured / not configured, with the exact fix command
│     (status derived from real bindings — GET /api/v1/instance/status)
└── API tokens
      moved from Conference settings; per-token name · prefix · scopes ·
      event scope (All conferences / named) · created_by · last used · Revoke
```

Conference settings keeps: Conference · Venues · Task templates · Airtable ·
Webhooks. The Organizers card leaves Conference settings (it was only there
because that's where an organizer already looked — its home now exists).

Sidebar: Organization group = People CRM · Outreach · **Settings** (⚙).

---

## Prototype-mock scope (pipeline-v1.1 → v1.14) — SHIPPED

*Built and pushed the same session (commit `9febf470`), verified in the
embedded browser: all four tabs, five themes applying, invite mint → pending
row, the removal transaction revoking the removed organizer's token, the
remove-demo round trip, the `settings/api` redirect, and the cold-start walk
unbroken. The CRM prototype's shared sidebar gained the same Settings row.
Awaiting Atin's drive-through (the love pass).*

1. **Sidebar**: ⚙ Settings row closing the Organization group (matching the
   v1.13 sidebar's conventions; reserved icon column, no jumps).
2. **New `#org` surface** with the four tabs above, reusing the settings-tabs
   pattern:
   - Organization tab: name, default timezone, default-theme picker (five,
     production labels — picking one applies it live where the prototype can),
     Communication defaults card, Branding card, Remove demo data.
   - Organizers tab: `organizersCard` relocated and extended — role+scope
     chips, O3 removal dialog (sessions/links revoked line, minted-tokens
     checklist defaulting to revoke, assignment count line, dual-seat note
     when applicable), invite modal with role + scope + QR + short code.
   - Instance tab: `instancePanel` rendered as steady state outside the setup
     walk.
   - API tokens tab: moved from Conference settings; `settingsTabs` loses it.
3. **Theme registry**: relabel `Day`/`Night` → `Marquee Light`/`Marquee Night`;
   add `latent-space` · `ai-engineer` · `swyxy` rows with production labels.
   Registers apply as best-effort palette re-lights in the prototype; the full
   register chrome (marks, casing, layout tropes) remains build-only and the
   mock says so honestly rather than faking it.
4. **Speaker-side actions** (O5) are *not* part of the org surface mock; the
   Remove-from-conference dialog and portal-access revocation belong to the
   person-record surface and can be mocked there in a follow-up round.

Non-negotiables inherited: Flight Deck tokens, PROTOTYPE badge, elements never
jump, nothing dead (toast), honest empty states, self-contained file://.

---

## Build implications (for eventual tickets — not prototype scope)

- `organizations` gains profile/default columns (name exists; default
  timezone, default theme, comms defaults, branding assets).
- Invite mint (`POST /api/v1/org/invites`) gains `role` and `event_id`
  (scope); exchange creates the membership with both. Short-code form of the
  one-time link (same token row, readable encoding).
- Organizer removal already revokes sessions in-transaction (Amendment 19);
  adds: consume unexpired login links, and accept a list of the member's
  `created_by` tokens to revoke in the same transaction.
- `readTheme()` falls back to the org default instead of hard-coded `day`;
  per-user choice still wins.
- New person-record routes: remove-from-conference cascade (participations
  ended, `reconcileTaskSet`, event access revoked; published sessions
  untouched per O5a) and portal-access revocation.
- Person delete/merge: CRM-scope work, tracked with the People-area scoping.
- Token move is UI-only; routes are already `/org/tokens`.
