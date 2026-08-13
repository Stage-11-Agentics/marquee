# MRQ-151: V2-2: the review chain tells the reviewer and the chair the same truth

Source: .briefs/eval-gap-v2-human-lens.md section 4, authored by Fable (Eval V2 Audit, surface:55). Operator-approved 2026-08-12. Read that section for the full human-problem framing before starting. (V2-2, ~60 min, one agent, four small fixes across the reviewer/evaluation surfaces.)

1. QUEUE COPY STATES THE REAL RULE. Replace 'in your authorized tracks' and the responsibility panel's track-intersection sentence with the rule the engine actually enforces: 'assigned to you — directly or through your committee — within your track responsibility.' (Closes ABS-05, w3 partial.)

2. THE INVITE SIGN-IN LINK IS READABLE, NOT ONLY COPYABLE. Render the full URL as wrapping text (an anchor or code block), keeping the Copy button. A human can read it over a shoulder; an agent can read it from the accessibility tree. The eval logged this as a defect: the credential is displayed truncated inside a readonly input with only a Copy button, and the conference only emails allowlisted addresses, so that IS the delivery path. (Closes CFP-10, w2 partial; also unblocks ABS-05 verification.)

3. EXPORTS SAY WHAT THEY DID. After either export: 'Exported {n} rows · {filename}' in the existing notice slot. The error path already exists. (Closes ABS-13, w2 partial.)

4. ONE SCORE, ONE NAME. The record's per-review row shows the same weighted value the list shows, via the shared review-aggregate definition, labelled, with the raw optional scalar as secondary detail. 'Saved by reviewer {actor_id}' becomes the reviewer's name. Pure legibility — this hardens CFP-11's pass.
   NOTE FOR WHOEVER PICKS THIS UP: an earlier evaluation filed a data-integrity defect here claiming a comment appeared on the wrong reviewer's row and a 4.00 displayed as 2.00. BOTH DISSOLVED on investigation — the demo reviewer seat resolves to per_reviewer-dario-quill (so the comment was on its own row), and the UI labels weighted vs unweighted rows. There is NO corruption bug. This item is about making that legible so no future reader repeats the misreading. Do not go hunting for a data bug that does not exist.

VERIFY. As demo reviewer (chip reads 'Reviewing as ...'), save 4/4/4/4 plus a comment; the organizer record shows that name, that comment, 4.00 weighted. Invite a reviewer; read the link text without clicking Copy. Fire both exports; see the confirmation.
