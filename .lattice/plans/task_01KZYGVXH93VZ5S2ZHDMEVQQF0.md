# MRQ-168: Speaker-uploaded files are reachable by permanent unauthenticated links that cannot be revoked

## What happens

Every stored file — a speaker's headshot, a signed contract, an uploaded slide deck — is
represented outbound as one thing: `publicMediaUrl()`
(`src/lib/r2/keys.ts:29`), a URL on the media origin that anyone holding it can fetch.
The API says so out loud: `files.queries.ts:215` sets
`link_policy: "unauthenticated-capability-url"`, and the OpenAPI text for the files
export (`files.routes.ts:32`) states "Every returned file URL is an unauthenticated
capability URL on the media origin."

To be fair to the design as it stands: the key is **not guessable**. `objectKeyFor()`
appends a fresh `crypto.randomUUID()` per object, so 122 bits of entropy sit between an
attacker and a URL, and `serveMediaObject` forces `Content-Disposition: attachment` and
`nosniff`. This is a capability-URL design, not an open bucket.

The defect is what the capability lacks:

- **No expiry.** The URL is valid forever. `publicMediaUrl` is called "stable" on purpose.
- **No revocation.** There is no way to cut a link that escaped. Removing the person from
  the event, deleting the participation, or revoking the organizer's access does nothing
  to a URL already in someone's hand.
- **It is handed out in bulk.** The files export returns one row per deliverable with the
  URL in it, to any caller with `program:read`. One CSV in a Slack channel or a forwarded
  email publishes every speaker's uploads to everyone downstream of it, permanently.

A speaker uploading a contract to a conference has not consented to a link that outlives
their involvement and cannot be withdrawn.

## Why it is worth building anyway

No rubric item covers it; it surfaced in round-5 browsing. It is on the list because it is
a privacy defect in someone else's data, which does not need a judge to be worth fixing.

## Shape of a fix

The pieces are already there — the app origin already authorizes reads, and
`serveInlineImageObject` shows the pattern of gating bytes behind an authorized caller.

Preferred: **short-lived signed media URLs**. Keep the separate media origin (the
isolation it buys is real and documented in `serve.ts`), but sign the path with an expiry
and verify at the edge, so a leaked link dies on its own. Mint them at read time in the
surfaces that need them.

Acceptable alternative: serve through the app origin behind the existing authorization,
for everything except the narrow inline-headshot case already argued for.

Either way, the files export must stop being a permanent bulk grant: it should either
carry short-lived links or say plainly that it carries none.

## Acceptance

- A media URL obtained today stops working after a bounded lifetime, proven by a test.
- Revoking a person's participation, or deleting the attachment, invalidates outstanding
  links rather than leaving them live.
- The `link_policy` field and the OpenAPI description are updated to describe what is
  actually true afterwards — this codebase says what its links do, and that stays true.
- The separate-origin isolation and `Content-Disposition: attachment` / `nosniff` behaviour
  in `serve.ts` are preserved.
