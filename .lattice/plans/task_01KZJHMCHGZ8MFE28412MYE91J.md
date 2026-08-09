# MRQ-55: Spike — ICS rendering in real mail clients

BUILDPLAN: S-2 — spike (§6). Time-boxed; **fails loudly rather than leaking into a feature build.**

Question it settles (verbatim): Does a `METHOD:REQUEST` invite render as **Accept/Decline** in Gmail, Outlook, and Apple Calendar — and does a `SEQUENCE+1` update *replace* the entry rather than duplicate it, and a `CANCEL` remove it? Neither Google nor Microsoft publishes a normative statement; this is the 15 minutes that separate R3 working from R3 looking like it works. **Runs as a standalone ~30-line script that hand-builds a `METHOD:REQUEST` + `SEQUENCE+1` + `CANCEL` triplet and sends it through Resend to the three inboxes — it needs no product code and can fire the moment `marquee@stage11.systems` is confirmed.**

Box: 1 h + operator inboxes. Blocks: **M-24** — the builder is written against the verdict, not the reverse. When: **D+2**, before any product code depends on the answer.
Human precondition (§8 item 6): three real inboxes — one Gmail (mandatory), one Outlook, one Apple Calendar — and a click on **Accept** in each. Needed within two hours of dispatch, not on Sunday afternoon.

ACs: — (de-risks AC-95, AC-97, AC-124; settles gate 10's shape)
Hours: 1
Workflow: fast-track
Shared files: none — standalone script; nothing merges into `src/` from here.
Deps: none
Plan:

1. Add `spikes/s2-ics-clients/send.mjs`, a dependency-free Node sender that accepts exactly one recipient argument, reads `RESEND_API_KEY` from the environment, and sends a deliberately paced three-message lifecycle through Resend from `Marquee <marquee@stage11.systems>`.
2. Hand-build RFC 5545 calendar bodies with CRLF line endings and one stable UID: `METHOD:REQUEST` / `SEQUENCE:0` at 15:00 America/New_York, `METHOD:REQUEST` / `SEQUENCE:1` at 16:00, then `METHOD:CANCEL` / `SEQUENCE:2` plus `STATUS:CANCELLED`. Every request includes `ATTENDEE;RSVP=TRUE`, `ORGANIZER`, `DTSTAMP`, `VTIMEZONE`, `TZID`, and a clear spike label.
3. Submit each message through Resend's documented SMTP interface using Nodemailer's dedicated `icalEvent` part, because Resend's REST send API exposes neither raw MIME nor a calendar-part content type/method. This produces text and HTML plus `text/calendar; method=<METHOD>` multipart alternatives. Resolve the exact recipient, subject, and send-time window through Resend's sent-email API (Resend replaces SMTP Message-IDs before indexing), fail if it is not indexed, and print only the numbered subject plus canonical Resend ID, never credentials or request payloads.
4. Add `spikes/s2-ics-clients/VERDICT.md` with the exact wire contract, expected Gmail/Outlook/Apple outcomes, explicit pending-vs-observed distinctions, a two-minute operator checklist, and the identical one-command resend path for future Outlook and Apple addresses.
5. Validate locally without sending by exercising an exported payload builder: assert stable UID, sequences 0/1/2, changed start time, required METHOD/ATTENDEE/ORGANIZER/STATUS fields, MIME content type, and absence of real addresses/secrets from tracked files. Then load the key from the external Subterra env file into the process without printing it and send the three-message series once to the provided Gmail oracle.
6. Record the three accepted Resend API IDs as `validation` evidence, commit, self-review the exact final commit/diff, attach the inline verdict, push the branch, open the Forgejo PR against `master`, attach it, and transition MRQ-55 to `pr_open`. Flag the matrix as pending operator inbox inspection and missing Outlook/Apple addresses; do not claim client behavior from API acceptance.

Working base: `forgejo/master` at `bed8486d65220ef12539c65e4916313dc2dd9223`.
