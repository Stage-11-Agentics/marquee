# Seed data — provenance and notice

Marquee ships with a seeded demo event so that a fresh clone is a working product
rather than an empty database. This document says exactly where that data comes
from, what is real, and what is invented.

## Provenance

The seeded **accepted core** combines 60 sessions and their 75 speakers from the
**publicly published AI Engineer Summit February 2025 program**
(`https://www.ai.engineer/summit/2025/schedule`), captured 2026-08-08 and stored in
this repository at `sequence/research/sources/aie-summit-2025-program.json`. Session
titles, public abstracts, speaker names, job titles, companies, public bios, and
public profile links are reproduced from that published program. Each seeded
submission carries its origin in `external_ref` as `aie-2025:<source id>`.

The accepted-speaker pool is extended with the **89 real, public speakers from
AIE CODE Summit November 2025** (`https://www.ai.engineer/code/2025`). The archived
five-group roster enumerates 80 people once pair cells are split; nine omitted
co-speakers and program participants are reconciled from AIE's published talk
recordings. Names are trimmed and deduplicated before any ID or email is allocated,
including a published spelling correction for Aparna Dhinakaran/Dhinkaran. The
two source sets resolve to 153 distinct accepted-speaker memberships. CODE-only
speakers are not attached to invented submissions; only their public name and
company are reproduced.

Everything else in the seed — the event itself (*AI Engineer New York 2026*), its
formats, tracks, buildings, rooms, waves, forms, task templates, and every
submission outside the accepted core — is **invented for demonstration**.

## What is synthetic, always

- **Email addresses.** Every seeded address is `firstname.lastname@example.com`.
  `example.com` is reserved by RFC 2606 and can never receive mail. No real
  address for any real person appears in this repository, the seed output, or a
  log. The captured source payload was scrubbed of addresses at capture time.
- **Headshots and profile photos.** None are downloaded, hotlinked, or re-hosted.
  Speaker imagery is rendered locally as deterministic initials-on-colour
  placeholders.
- **Contact and travel details.** No phone numbers, no passport or visa data, no
  realistic travel logistics. Travel-related fields carry obviously synthetic
  values.
- **Every non-accepted submission.** The rejected, waitlisted, under-review, and
  draft pool is entirely fabricated, with synthetic names and invented companies.
  A real person is never attached to a fabricated submission, and a fabricated
  abstract is never attributed to a real person.
- **Every sponsor.** Both seeded sponsorships are invented end to end — the
  companies, the four contacts, the named speaker, the deliverables, the booth,
  and the three sponsor Sessions. AI Engineer's actual sponsors are not this
  project's to publish, and attaching a real 2025 speaker's real talk to a
  fabricated sponsor would misrepresent that person. Nothing in the sponsors seed
  is drawn from the source program.

## Sponsorships in the demo

Two sponsorships ship so the sponsor portal is demonstrable in both of its
compositions, which is the whole reason there are two:

| | Gold | Silver |
|---|---|---|
| Company | Ashworth–Meridian Capital Intelligence Group | Tapestry Small-Business Lending |
| Contacts | 3 — `dana.okafor@example.com` (primary), `priya.raghunathan@example.com`, `grzegorz.wlodarczyk@example.com` | 1 — `mona.haddad@example.com` (primary) |
| Booth | 214, Sheraton Exhibit Hall · Level 2, with load-in and a map pin | none — every booth column null |
| Deliverables | 8, including one **overdue** (the logo, assigned to Grzegorz) and one **cancelled** with its reason | 4 |
| Sessions | 2 — one scheduled and published, one with **no speaker named** | 1 — scheduled but **not yet public** |

The Gold sponsorship is the demonstration that any contact can complete any
deliverable: its overdue logo request is assigned to the contact least likely to
be the one signing in, and whoever completes it is named on the row afterwards.
Grzegorz Włodarczyk-Ó Braonáin's name is long and carries two diacritics on
purpose — every surface it appears on has to survive it.

On a demo instance the sign-in form returns the magic link on screen for any
seeded address, so entering the portal as any of the four contacts takes about ten
seconds and exercises the real magic-link door rather than a shortcut.

## Demo workflow coverage

The synthetic pool retains its 1,000 deterministic submission rows while making
the complete organizer pipeline reachable: one existing pool record is `submitted`,
one is `withdrawn`, and the accepted core contains an unscheduled Wave-1 Session
whose required speaker tasks are complete. The latter is intentionally a genuine
**Ready to place** row — it has no agenda slot, no open speaker task, and no
pending acceptance wave.

The scheduled agenda emits **twenty-six sessions plus one break** and spans every
format the conference runs: Stage Talks, five
parallel Workshops in the Marriott rooms, the Expo Stage's Lightning block
running through the mainstage break, and two Online sessions in the virtual
room. Each item's duration defaults from its format, so a Lightning slot is ten
minutes and a Workshop is ninety. Every scheduled record is in Wave 1 — a
speaker on the public agenda has always been invited. Ten of the twenty-six
sessions are accepted Abstracts rather than Sessions, which is a supported state: the
unscheduled pool and the agenda both take any accepted record.

Confirmation responses are also deliberately mixed for the walkthrough. The
seed includes `confirmed`, `pending`, and two `declined` participations. One
scheduled Session carries two roles for the same person — one confirmed and one
declined — plus a pending co-speaker role, so the agenda's derived
`has_declined_participant` flag is true and the submission record can show all
three response states.

## Notice

This seed is **derived from the publicly published AI Engineer Summit February
2025 program and CODE Summit November 2025 roster/recordings, and provided for
demonstration purposes only**. Contact details, images, and all non-accepted
submissions are synthetic. Marquee has **no affiliation with, and is not endorsed
by, AI Engineer** or any speaker, company, or venue named in the seeded data.

If you are named in the seeded program data and would prefer not to be, open an
issue and the record will be removed.
