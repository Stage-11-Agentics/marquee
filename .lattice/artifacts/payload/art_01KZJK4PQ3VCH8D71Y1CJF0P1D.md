# S-2 ICS client verdict

## Verdict status

The wire-format and Resend-delivery halves of the spike are complete. Client rendering remains an operator oracle: this sender cannot open a recipient inbox, and mail-server delivery does not prove what Gmail, Outlook, or Apple Calendar rendered.

| Client | Sent | Client verdict |
|---|---|---|
| Gmail | Yes, to the operator-provided Gmail oracle | Pending inbox inspection |
| Outlook | No — an Outlook address is still needed | Pending address and inspection |
| Apple Calendar | No — an Apple-backed address is still needed | Pending address and inspection |

The recipient and Resend response IDs are deliberately kept in MRQ-55's private Lattice validation evidence, not in this public-repository artifact.

For the Gmail oracle run on 2026-08-09, Resend recorded 1/3 as delivered at 06:21:01 UTC, 2/3 at 06:21:47 UTC, and 3/3 at 06:21:49 UTC. The first gap is intentional recovery evidence: Resend accepted 1/3 over SMTP but replaced its Message-ID before indexing, so the initial exact-Message-ID lookup stopped the command before 2/3. The resolver was changed to the recipient/subject/send-time tuple, and the run resumed at 2/3 without duplicating the invite. All future full-series runs use the corrected resolver.

## Exactly what the series sends

Run from this directory with Node 22+ after `npm install`:

```sh
RESEND_API_KEY="..." node send.mjs recipient@example.com
```

The command sends exactly three messages through Resend, one second apart, from `Marquee <marquee@stage11.systems>`. Each has plain-text and HTML alternatives plus one `text/calendar; method=<METHOD>` alternative (and Nodemailer's compatibility `.ics` copy). The calendar data uses CRLF line endings and folded lines.

All three messages use:

- `UID:mrq-55-s2-20260909@stage11.systems`
- `ORGANIZER;CN=Marquee:mailto:marquee@stage11.systems`
- `ATTENDEE;CN=ICS Spike Recipient;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:<recipient>`
- `TZID:America/New_York` with embedded daylight/standard `VTIMEZONE`
- summary `Marquee S-2 ICS client spike`
- location `Metropolitan Ballroom · Sheraton New York Times Square`

| Message | Subject | Calendar operation | Event time |
|---|---|---|---|
| 1/3 | `[S-2 spike 1/3] Invite — 15:00 ET` | `METHOD:REQUEST`, `SEQUENCE:0`, `STATUS:CONFIRMED` | Sep 9, 2026, 15:00–15:30 ET |
| 2/3 | `[S-2 spike 2/3] Update — 16:00 ET` | `METHOD:REQUEST`, `SEQUENCE:1`, `STATUS:CONFIRMED` | Sep 9, 2026, 16:00–16:30 ET |
| 3/3 | `[S-2 spike 3/3] Cancel — 16:00 ET` | `METHOD:CANCEL`, `SEQUENCE:2`, `STATUS:CANCELLED` | Sep 9, 2026, 16:00–16:30 ET |

`DTSTAMP` is the invocation time, increasing by one second across the series. After each SMTP acceptance, the sender resolves the exact recipient, subject, and send-time window through Resend's sent-email API and prints only the canonical Resend ID. (Resend replaces the SMTP Message-ID before indexing.)

## Expected client behavior

- Gmail: message 1/3 shows Accept/Decline controls; accepting creates one 15:00 event. Message 2/3 moves that same event to 16:00 without leaving a 15:00 duplicate. Message 3/3 marks it cancelled or removes it.
- Outlook: the same RSVP, single-entry update, and cancellation behavior.
- Apple Calendar: the same RSVP, single-entry update, and cancellation behavior.

These are expectations to test, not observed results. A client that shows only a downloadable attachment, keeps both time slots, or retains an active event after 3/3 is a failed row and must shape M-24's implementation verdict.

## Two-minute operator checklist

1. Open Gmail and search for `[S-2 spike]`; sort or open the clearly numbered messages 1/3 → 2/3 → 3/3.
2. Open 1/3: the invite should show RSVP buttons. Click **Accept**, then confirm one event exists at 15:00 ET.
3. Open 2/3: the 15:00 slot should now read 16:00 ET, with no duplicate at 15:00.
4. Open 3/3: the event should be cancelled or absent from the calendar.
5. Record `PASS` or the exact divergence for RSVP, update replacement, and cancellation. Repeat the same checklist after running the identical one-command series for Outlook and Apple addresses.

Because the full triplet may be processed before inspection, also record if an older message already reflects the newest calendar state. That is useful client behavior evidence, not a reason to infer a pass.