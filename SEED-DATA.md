# Seed data — provenance and notice

Marquee ships with a seeded demo event so that a fresh clone is a working product
rather than an empty database. This document says exactly where that data comes
from, what is real, and what is invented.

## Provenance

The seeded **accepted core** combines 60 sessions and their 75 speakers from the
**publicly published AI Engineer Summit February 2025 program**
(`https://www.ai.engineer/summit/2025/schedule`), captured 2026-08-08. The source archive is not redistributed in this public snapshot. Session
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

## Notice

This seed is **derived from the publicly published AI Engineer Summit February
2025 program and CODE Summit November 2025 roster/recordings, and provided for
demonstration purposes only**. Contact details, images, and all non-accepted
submissions are synthetic. Marquee has **no affiliation with, and is not endorsed
by, AI Engineer** or any speaker, company, or venue named in the seeded data.

If you are named in the seeded program data and would prefer not to be, open an
issue and the record will be removed.
