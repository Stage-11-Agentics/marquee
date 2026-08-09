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
Plan: filled in by delegator's plan phase
