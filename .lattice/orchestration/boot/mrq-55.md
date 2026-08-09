FIRST ACTION, before anything else, run exactly:
`test "$(pwd)" = "/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-55-spike-ics" || { echo "FATAL: wrong cwd"; exit 99; }`
On failure HALT and report — do not cd, do not improvise.

Read `/Users/atin/Projects/Stage11/deployments/Marquee/.lattice/orchestration/boot/COMMON.md` and follow it. Your ticket: **MRQ-55** (BUILDPLAN **S-2**, spike, ~2h, fast-track — self-review, no headless reviews). Actor: `agent:delegator-mrq-55`. Branch: `mrq-55-spike-ics`.

**Question to settle** (full text in `lattice show MRQ-55 --json`): does a `METHOD:REQUEST` ICS invite render as **Accept/Decline** in Gmail, Outlook, and Apple Calendar; does a `SEQUENCE+1` update **replace** the entry rather than duplicate it; does a `CANCEL` remove it? This de-risks M-24 (calendar invites), which is written against your verdict.

**Method:**
1. Read `/Users/atin/Projects/Stage11/code/platform/resend.md` first (sender conventions, verified domain `stage11.systems`, free-tier limits).
2. Build a standalone sender under `spikes/s2-ics-clients/` in your worktree: minimal ICS builder (REQUEST with `ATTENDEE;RSVP=TRUE`, ORGANIZER, UID, SEQUENCE; then an update with SEQUENCE+1 and a changed time; then METHOD:CANCEL) sent as proper `text/calendar; method=REQUEST` MIME alongside multipart alternatives.
3. Send via Resend. `RESEND_API_KEY` is in `/Users/atin/Projects/Stage11/code/subterra/.env` — read at runtime, **never commit, echo, or log it**. From-address: `marquee@stage11.systems`. Keep total sends well under 20 (free-tier 100/day is shared).
4. **Gmail oracle available now:** send the full three-step series (invite → update → cancel), clearly labeled subjects (`[S-2 spike 1/3] ...`), to `benevolent.futures@gmail.com`. Outlook and Apple inboxes are not yet provisioned — prepare the identical series as a one-command re-send (`node send.mjs <address>` or similar) and note it in the verdict.
5. You cannot open the recipient inbox. Deliverable is therefore: (a) the sender + a `VERDICT.md` documenting exactly what was sent, what each client is expected to show, and a 2-minute operator checklist ("open Gmail → the invite should show RSVP buttons; after 2/3 the 15:00 slot should read 16:00 with no duplicate; after 3/3 it should be cancelled"); (b) evidence of accepted delivery (Resend API response IDs) attached `--role validation`.

Commit, self-review, attach the verdict inline, open the PR, bump `pr_open`, then c11-send the Orchestrator: what was sent, that the Gmail series is waiting in `benevolent.futures@gmail.com`, and that Outlook/Apple addresses are needed to complete the matrix.
