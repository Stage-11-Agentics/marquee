# MRQ-171 implementation plan

## Scope

Split the reviewer seat into a reviewer home at `/reviewer` and the existing
working surface at `/reviewer/queue`, preserving the review authorization,
scorecard, anonymity, comparison, and modal behavior already shipped.

## Implementation

1. Trace the existing reviewer payload, route dispatch, shell exceptions, sign-in
   destinations, reviewer links, speed check, docs, and tests. Confirm the
   existing profile form and `/api/v1/me/profile` contract before editing.
2. Extend the existing queue response with committee membership using the
   canonical membership seam; do not add a second queue or profile endpoint.
3. Refactor the reviewer UI into home and queue modes. Home renders assignment,
   responsibility, completed reviews, and the shared profile editor. Queue keeps
   the scorecard flow, removes duplicated home panels, reports progress, and
   exits with a real `/reviewer` link.
4. Update route/shell/sign-in/landing/invite/seat/public-link/docs/speed seams and
   add focused tests for home, queue routing, committee data, profile reuse,
   progress, empty states, and blind-review redaction.
5. Run the required static/unit gates, then run the dev server with
   `INSECURE_LOCAL_COOKIES:1` and validate the reviewer flow in c11's WKWebView at
   desktop and 375px widths. Capture home and queue screenshots for the PR.

## Decisions to verify

- Keep `scripts/checks/speed.ts` on `/reviewer/queue` because the queue is the
  reviewer latency surface named by the ticket; the home should not make the
  check report a lighter false win.
- Use the existing reviewer route guard and session destination, changing only
  the destination path where the old queue entry point is intentionally a home.
- Preserve the completed-list truncation caption and anonymous titles exactly as
  the current payload provides them; no submitter identity should be added to
  home.

## Completion evidence

Commit each meaningful unit on `mrq-171-reviewer-home`, push the exact branch,
create one PR against `main`, record AC-by-AC results and honest gate/browser
evidence in the PR, then move MRQ-171 to `pr_open` without merging.
