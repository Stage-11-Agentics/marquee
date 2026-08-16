# SKILL.md setup chapter — draft, ready for the build

**Status.** `SKILL.md` is a generated artifact: `cli/generate-skill.mjs`
renders it from the CLI `COMMAND_REGISTRY`, and `tests/node/skill.AC-142-144`
asserts byte-equality. This chapter therefore cannot be hand-added to
`SKILL.md` today — and must not be, since it teaches commands that do not
exist yet. It lands by editing `renderSkill()` in the same PR that adds the
setup commands to the registry. Command names below are proposals; reconcile
them with the registry at build time.

The chapter is written in SKILL.md's own register — imperative, contract-like,
"inspect the returned state" — and encodes rulings D2, D4, D5, D6
(`prototypes/cold-start/DECISIONS.md`).

---

## Set up a new instance

This chapter is for a fresh deployment: an empty Cloudflare account and a
cloned repository. If `MARQUEE_URL` and `MARQUEE_TOKEN` already work, skip to
Seed. Setup is conversational — three questions belong to the operator, so ask
them before acting rather than guessing: which domain, whether to seed the
demo conference alongside, and whether a Resend API key exists yet.

Preconditions: Node 22.18+, `wrangler` authenticated against the operator's
Cloudflare account, Workers Paid enabled. Confirm Workers Paid by creating a
paid-only resource, not by reading an API that may lie about it.

1. Create the resources and record their IDs in `wrangler.jsonc`: one D1
   database, one R2 media bucket, one KV namespace, four queues. The exact
   commands are in the README under *Deploy to Cloudflare*; that sequence is
   the contract, follow it rather than improvising.
2. Store the secrets with `wrangler secret put`: the Turnstile pair, the R2
   signing keys, and the upload secrets. If the operator has no Resend key
   yet, say so and continue — the instance reports mail as not configured
   honestly, and warns before intake opens. Never block setup on mail.
3. Build, migrate, optionally seed, deploy, then verify:

   ```sh
   npm run build
   CI=1 npx wrangler d1 migrations apply DB --remote
   npm run seed -- --remote        # only if the operator wants the demo alongside
   npx wrangler deploy
   curl -fsS https://<domain>/health
   ```

   `health` names the build SHA it serves; confirm it matches what you shipped.

4. Print the claim link and hand it to the human:

   ```sh
   node cli/marquee.mjs setup claim-link --url "$MARQUEE_URL" --json
   ```

   The response contains a one-time claim URL; you may append
   `?name=…&email=…` prefill from the operator's git config. **Never open the
   claim link yourself. Ownership must land on a person, not on an agent.**
   Tell the operator to open it in a browser; a used link is inert, and
   re-running this command is the recovery path for a locked-out instance,
   forever.

5. Wait. When the human has claimed the instance, they hand you a scoped
   token (Marquee offers to mint one at claim). Export it as `MARQUEE_TOKEN`
   and verify it with a read before writing anything.

6. Provision the conference through the API, confirming each returned state:

   ```sh
   node cli/marquee.mjs event create --name "…" --start … --end … --timezone … --venue … --json
   node cli/marquee.mjs event tracks set <event-id> --json    # tracks, formats, rooms
   node cli/marquee.mjs forms draft <event-id> --json          # the call for speakers, unpublished
   node cli/marquee.mjs evaluation plan <event-id> --json      # scorecard, committee, rounds
   ```

   Sane defaults are already set — one speaker minimum, format durations
   prefilled. Change only what the operator asked for.

7. **Stop before intake.** Do not publish the call for speakers. Report what
   you did, the instance status rows (mail included), and where the last step
   lives: opening intake is the operator's click, from the dashboard, with
   the consequences on screen.

---

## Build notes (outside the chapter text)

- New registry commands implied: `setup claim-link`, `event create`, and the
  taxonomy/forms/evaluation write verbs — reconcile with whatever MRQ-104's
  loop verbs already added before minting new ones.
- The chapter goes into `renderSkill()` between **Authentication** and
  **Seed**, since it is the path that makes Authentication's preconditions
  true.
- `docs/GETTING-STARTED.md` is the human-side mirror of this chapter; keep
  their step order identical so an operator and their agent are reading the
  same story.
