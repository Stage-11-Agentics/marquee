# Plan Review: MRQ-81 — Public CFP submission blocked (headshot upload)

## 1. Verdict

**FAIL (plan-level)**

## 2. Summary

The submitted plan is a verbatim copy of the task description — every heading, every
paragraph, including the ticket's own `## Scope` and `## Verification` sections — with no
implementation plan appended. It carries a different ticket's identifiers (MRQ-79, branch
`mrq-79-public-cfp-file-upload`), so it appears to be a stale paste rather than a plan
authored for this task. Beyond the missing plan, I verified the cited root cause in source
and found the diagnosis **incomplete in a way that matters**: the Turnstile widget is never
mounted at all, every public route the flow touches is server-side gated on a non-empty
Turnstile token, and those tokens are single-use — so the three fixes the ticket names are
necessary but **not sufficient** to reach the ticket's own success condition.

## 3. Issues

---

**[CRITICAL] Whole document — There is no plan**

The `### Plan` section reproduces the task description word for word. It contains no
implementation steps, no ordering, no list of functions to change, no new or modified file
paths, no test file names, no acceptance criteria, and no design decisions. Every place
where the ticket poses a choice, the plan restates the choice instead of resolving it:

- "Prefer completing the upload after `ensureDraft()` **rather than bouncing the user, if
  the security check allows it**" — the plan does not establish whether the security check
  allows it. (It does not; see below.)
- "Verify the crop preview ... **either appears or the label stops promising it**" — the
  plan picks neither.
- "Re-check the other `resetTurnstile()` call sites" — the plan does not report the result
  of that re-check.

A plan whose entire content is the ticket gives the implementer nothing to review against
and gives this gate nothing to evaluate. The decisions the ticket deliberately deferred to
planning are exactly the ones still open.

**Recommendation:** Return to `in_planning`. The plan must add, at minimum: (a) the chosen
Turnstile mounting/lifecycle design, (b) the chosen resolution of the crop-preview promise,
(c) the exact functions and files being changed, (d) named test files with `AC-<n> · `
titles, (e) the findings from the call-site re-check. The ticket text may be referenced,
not reproduced.

---

**[CRITICAL] Delivery / File ownership — Wrong ticket identifiers throughout**

The task specifies branch `mrq-81-public-cfp-file-upload` and ownership keyed to MRQ-81.
The plan specifies branch `mrq-79-public-cfp-file-upload` and states "MRQ-79 OWNS" /
"MRQ-79 MUST NOT TOUCH."

This is not cosmetic. The fleet merge driver keys file ownership by ticket, and a delegator
that reads its own plan literally will cut the wrong branch, open a PR that appears to
belong to a different ticket, and register its ownership claim under MRQ-79 — a ticket that
either does not exist in this run or belongs to someone else. Two agents claiming
overlapping paths under mismatched IDs is how the merge queue corrupts.

**Recommendation:** Correct all three occurrences to MRQ-81 before implementation begins.
Given this is a stale paste, re-verify that nothing else in the plan was inherited from the
other ticket.

---

**[CRITICAL] Root cause — The Turnstile widget is never mounted, and the plan does not
address it; the specified fixes will not reach the ticket's success condition**

The ticket's diagnosis stops one level short. Verified in source:

`src/ui/public/form/PublicForm.tsx:98` loads the Turnstile script with `?render=explicit`:

```js
script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
```

But **`turnstile.render(...)` is never called anywhere in the file** (or anywhere under
`src/`). The only widget container is the implicit-mode markup at line 318:

```jsx
<div class="cf-turnstile" data-sitekey={...} data-callback="marqueeTurnstileCallback" />
```

`render=explicit` is precisely the flag that *disables* auto-rendering of `.cf-turnstile`
elements. So the widget never mounts, `marqueeTurnstileCallback` never fires,
`turnstileToken` stays `""` for the lifetime of the page — and `turnstile.reset()` has no
widget to find, which is the literal source of
`TurnstileError: Nothing to reset found for provided container`. The ticket treats the throw
as the bug; the throw is a **symptom of the unmounted widget**, and so is the empty token.

That distinction decides whether the ticket succeeds, because the empty token is fatal
server-side. `src/lib/r2/turnstile.ts:19-21`:

```ts
if (!params.token || params.token.trim() === "") {
  return { ok: false, errorCodes: ["missing-input-response"] };
}
```

It short-circuits **before** contacting siteverify — so the always-pass test keys in
`.dev.vars` cannot rescue an empty token. And every route this flow touches is gated:

| Route | Gate |
|---|---|
| `POST /forms/{slug}/drafts` | `requireTurnstile` — `public-form.routes.ts:461` |
| `POST /forms/{slug}/submissions` | `requireTurnstile` — `public-form.routes.ts:565` |
| `POST /public/uploads/sign` | `verifyTurnstile` + single-use consume — `uploads.routes.ts:146-155` |

Consequence: an implementer who follows this plan literally — wrap `reset()` in try/catch,
remove the first-selection bail, surface the message — will produce a form that no longer
throws and no longer hides its error, and **still cannot upload a headshot or submit**,
because `ensureDraft()`'s POST and the presign will both return 403 `turnstile_failed` on
the empty token. The ticket's first scope bullet ("attach a headshot and submit
successfully, first try, logged out, with no console exception") is unreachable without
mounting the widget.

This also reframes the blast radius: this is not a file-upload bug. With no token, *no
draft can be created and no submission can be sent* through `/f/cfp` by any path. Text
fields appear to work only because `setAnswer` clears their required state purely
client-side; the wall appears at the first network-touching action.

**Recommendation:** The plan must decide and state the mounting strategy — either call
`turnstile.render()` explicitly against a ref'd container once the script loads (keeping
`render=explicit`, and capturing the returned widget ID for `reset(widgetId)`), or drop
`?render=explicit` and let the existing `.cf-turnstile` markup auto-render. The explicit
path is the better fit here because the code already wants to reset a specific widget, and
a captured widget ID also makes `resetTurnstile()` genuinely safe rather than merely
try/caught. Note this is squarely inside MRQ-81's owned paths (`src/ui/public/form/*`), so
there is no ownership obstacle. Add an AC for it, and add a regression test asserting a
widget is rendered and the callback wired.

---

**[MAJOR] Scope — The preferred fix ("complete the upload after `ensureDraft()`") is
infeasible as written; Turnstile tokens are single-use and the plan does not reckon with it**

The ticket prefers uploading immediately after `ensureDraft()` instead of bouncing the user,
qualified with "if the security check allows it." It does not — and the plan never checks.

`requireTurnstile` (`public-form.routes.ts:136-140`) records each token in KV and rejects a
replay: *"That security check has already been used."* `consumePublicTurnstileToken`
(`uploads.routes.ts:66, 154`) does the same for the presign path: *"Turnstile token has
already been used."*

So on a first-time file pick, the single solved token is spent by `ensureDraft()`'s draft
POST. The subsequent `/uploads/sign` call needs a **second, freshly solved** token. Worse,
`ensureDraft()` calls `resetTurnstile()` on its own success path (line 193) — clearing the
token by design — while `handleFile` then reads `turnstileToken` from a stale render
closure (line 234), so it sends either `undefined` or an already-burned value. Either way
the presign fails.

This is why the original author wrote the "choose the file once more" bounce: it is a crude
way to obtain a fresh token. The bounce is bad UX, but it was not arbitrary, and removing it
without replacing the token-acquisition mechanism trades a silent dead end for a 403.

**Recommendation:** The plan must specify the token lifecycle explicitly. The workable
shape: after `ensureDraft()` succeeds, reset the widget and **await a fresh token** (resolve
a promise from the Turnstile callback) before calling `/uploads/sign`, holding the selected
`File` in state across the wait so the person never re-picks — with a visible, honest
in-place status ("Confirming the security check…") rather than a bounce. If awaiting a fresh
token proves unreliable, the acceptable fallback is keeping an explicit re-pick prompt that
*actually renders*. Whichever is chosen, say which, and note that `turnstileToken` must be
read from a ref, not a stale closure. Do **not** relax either server-side gate — the ticket
forbids it and the form is anonymous.

---

**[MAJOR] Scope — The crop-preview copy lives in a MUST-NOT-TOUCH file; the plan does not
resolve the conflict**

The promise "JPG or PNG · crop preview appears before submission." is the field's
`help_text`, and it is defined at **`scripts/seed/event.ts:274`** — a path MRQ-81 **MUST NOT
TOUCH**. Meanwhile the public form's file branch (`PublicForm.tsx:300-303`) renders a bare
`<input type="file">` plus a saved-filename span: there is no preview and no crop. A working
implementation already exists nearby for reference in `src/ui/portal/PortalPage.tsx:385`
(`portal-crop`, preview `<img>`), but that is a different surface.

So of the ticket's two permitted resolutions, "the label stops promising it" is blocked by
file ownership, leaving "build the preview" as the only one this ticket can execute — and
the plan neither notices the constraint nor commits to the surviving option.

**Recommendation:** State plainly that the copy is unreachable under this ticket's ownership
and commit to rendering a client-side preview in `src/ui/public/form/*` (object-URL preview
on selection, revoked on change/unmount, with reserved space so the row does not shift —
see the ELEMENTS NEVER JUMP note below). Give it its own AC. If the fleet would rather
change the seed copy, that is a separate ticket and the plan should say so rather than
silently touching `scripts/seed/`.

---

**[MAJOR] Verification — No acceptance criteria are minted, so `trace:ac` has nothing to
key to**

The constraints require every test title to begin `AC-<n> · ` or `CONTRACT · `, enforced by
`trace:ac`. The plan numbers no ACs and names no test files. The implementer is left to
invent both, which defeats the purpose of reviewing a plan before implementation and makes
the review gate downstream unable to check coverage against anything.

**Recommendation:** Enumerate ACs explicitly and map each to a named test file. A minimum
set given the findings above:

- AC-1 · a Turnstile widget mounts on the public form and the callback populates the token
- AC-2 · `resetTurnstile()` cannot throw with no widget mounted (and does not suppress a
  subsequent `setPageError`)
- AC-3 · a successful file upload calls `setAnswer` and clears the field's required state
- AC-4 · a first-time file selection completes without demanding a re-pick, or renders its
  explanatory message
- AC-5 · a crop preview renders for a selected image, in reserved space
- CONTRACT · the presign call carries a fresh, unconsumed Turnstile token

---

**[MINOR] Root cause — Cited line numbers and the call-site count do not match the file**

The plan (inheriting the ticket) cites `resetTurnstile` at line 76, `setAnswer` at 248,
`void handleFile` at 311, and says `resetTurnstile()` is "called twelve times" at sites
including 183, 190, 193, 238, 270, 283, 285. In the current file the definition is at **83**,
`setAnswer` at **244**, `void handleFile` at **303**, and there are **seven** call sites —
**193, 196, 226, 243, 246, 269, 271**. Lines 183, 190, 283 and 285 are not `resetTurnstile`
calls. The substance of the diagnosis holds; only the coordinates drifted.

**Recommendation:** Re-anchor to the current line numbers so the implementer does not chase
phantom sites or conclude the file changed under them. Note that of the seven real sites,
the swallowed-message pattern applies at **196, 226 and 246** — each immediately precedes a
`setPageError`. Line 269 is on a success path and 243 precedes `setAnswer`, which is a
different failure (the answer never lands), also worth its own line in the plan.

---

**[MINOR] Constraints — ELEMENTS NEVER JUMP is already satisfied by an existing mechanism**

The form already reserves the error row: `PublicForm.tsx:308` renders
`{error ?? " "}` inside a permanently-present `public-field-error` div, toggling a
`has-message` class rather than mounting and unmounting the node. An implementer who does
not notice this may reinvent it or, worse, replace it with conditional rendering and
reintroduce the jump.

**Recommendation:** Note the existing pattern in the plan and require the new preview and
any new status text to follow it — reserved height, class toggle, never conditional mount.

---

**[MINOR] Verification — Step 3 walks surfaces this ticket must not touch, with no
escalation path**

Step 3 requires walking review → accept → onboarding task → schedule → publish from the
newly created record. Those surfaces (`src/ui/submissions/*`, `src/ui/evaluation/*`,
`src/routes/submission-record.routes.ts`) are all MUST-NOT-TOUCH. Walking them read-only is
fine and valuable — this is the first real-submission traversal anyone has attempted — but
if the walk surfaces a defect, the plan says nothing about what to do, and the risk of an
implementer "just fixing it" in a forbidden file is real.

**Recommendation:** State that step 3 is observational, and that any defect found outside
MRQ-81's owned paths is filed as a new ticket and reported in the PR body, not fixed in
this branch.

---

## 4. Positive Observations

The credit here belongs to the ticket rather than the plan, but it is worth naming because
the plan should preserve it rather than dilute it:

- **The evidence chain is exemplary.** A named findings document, a screenshot, DOM-level
  state (`input.files.length === 1`, correct MIME and size), and an explicit rule-out of the
  two most likely false leads — automation artifact and missing credentials. That rigor is
  what let this review go straight to source and find the deeper cause instead of
  re-litigating the symptom.
- **The verification section refuses the easy win.** Demanding a real-artifact smoke on a
  real browser at a port nobody else holds, then insisting the loop be walked from a
  *newly created* record rather than a seeded one, is exactly the discipline that would
  have caught this blocker weeks ago. Keep it verbatim.
- **"A test that only checks the happy path would have missed this"** is the right
  instruction, and it is the reason the missing-widget finding above must become its own
  regression test rather than being absorbed into a general smoke pass.
- **File ownership is stated precisely**, with named ticket attributions for each forbidden
  path — which is what made the two ownership conflicts in this review detectable at plan
  time rather than at merge time.

The path forward is narrow and clear: correct the ticket identifiers, add the Turnstile
mounting and token-lifecycle design, commit to building the crop preview, mint the ACs, and
this becomes a strong plan for a genuinely important fix.
