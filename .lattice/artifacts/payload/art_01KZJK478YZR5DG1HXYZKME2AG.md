Observed 2026-08-09 via Resend API after SMTP submission to benevolent.futures@gmail.com:
1/3 REQUEST seq 0, 15:00 ET — Resend ID 33982b7f-8162-42e8-9215-ade40537cf03 — last_event=delivered at 06:21:01 UTC.
2/3 REQUEST seq 1, 16:00 ET — Resend ID 80e8404f-7410-4816-bea9-49595031eb1c — last_event=delivered at 06:21:47 UTC.
3/3 CANCEL seq 2, 16:00 ET — Resend ID c749f902-9f2a-4ce4-86f7-3c0553579af1 — last_event=delivered at 06:21:49 UTC.
Static wire evidence: npm test 3/3 PASS proves stable UID, sequence 0/1/2, changed DTSTART, CANCEL+STATUS:CANCELLED, RSVP attendee, organizer, CRLF/folding, and text/plain + text/html + text/calendar method MIME. Resend attachment metadata reports application/ics size 1149 bytes for 1/3.
Not observed: inbox rendering, RSVP interaction, calendar replacement/removal. Outlook and Apple series not sent because addresses are not provisioned.