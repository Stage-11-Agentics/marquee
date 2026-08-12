# Cloudflare credentials with Atin — walk him through it, then take the deploy as far as it goes

Repo root: `/Users/atin/Projects/Stage11/deployments/Marquee`. Read its `CLAUDE.md` first — it is binding.

You are an Opus agent launched by the merge driver at **surface:261**, on Atin's instruction: *"Walk me through getting those Wrangler credentials. I completely forgot to do that."*

**This is a conversation with a human, not a solo build.** Atin is at the keyboard and expects to work with you in this surface. You have been launched **flagged** on purpose — he intends to watch this one.

## Orient before you say anything to him

- `lattice show MRQ-57` — "Real Cloudflare deploy — resources, secrets, custom domain". Blocked on operator auth and nothing else.
- `sequence/OPERATOR-PRECONDITIONS.md` — sections **1, 2, 3** are the blocking Cloudflare ones (Workers Paid; R2 entitlement proven by a real fetch; `wrangler login` + account ID). Each says why it matters, how to check, and what done looks like. Read all three before opening your mouth.
- `~/Projects/Stage11/code/platform/` is the shared platform knowledge base — **read `cloudflare.md` there first.** It carries the account context, scoped tokens, exact API recipes and hard-won gotchas. Anything you learn tonight gets filed back there.
- **Coordinate, do not collide:** `surface:243` in workspace **Marquee QA** has been tracking this exact critical path and is holding a checklist. Read its state before duplicating its work — `c11 send --workspace workspace:12 --surface surface:243 "…"` to talk to it.

## How to run the conversation

Atin is an expert; do not over-explain. But **he is doing the parts no agent can do**, so be precise about exactly what he must type and what he should see back.

Give him **one step at a time, with the exact command**, and wait for the result before the next. Do not hand him a wall of ten steps. The interactive ones are his:

- `wrangler login` — a browser OAuth flow. He must be **`projects@stage11.ai`** (the Stage11 Projects account), not a personal account. If he is already logged in as someone else, catch that before it wastes a step.
- Confirm the account is on **Workers Paid**. The whole build assumes it; discovering otherwise late is the failure mode this precondition exists to prevent.
- **Prove the R2 entitlement with a real fetch**, not by reading a dashboard checkbox. A lapsed entitlement looks fine in the UI and fails on first use.

**Tell him to run interactive commands himself with the `!` prefix** in his prompt — `! wrangler login` — so the output lands directly in the conversation where you can both read it.

## Then do everything he does not have to

Once auth exists, the rest is yours and MRQ-57 lists it: create the real D1 / KV / R2 / Queue / cron resources and record their IDs; replace every `REPLACE_ME-<binding>` in `wrangler.jsonc`; real secrets via `wrangler secret put`; deploy; wire `marquee.stage11.dev`; run migrations against the real D1 and seed it so the deployed URL is a demo a judge can actually open.

Take it as far as it goes tonight. If he steps away mid-flow, keep going on everything that does not need him and leave a crisp "here is where I stopped and what you owe me" note.

## Hard rules — the repo goes public

- **`account_id` comes from env and is never committed. No secret enters the repo, ever.** This tree becomes a public open-source artifact; `scripts/checks/repo-policy.mjs` scans for leaks and the `forgejo.stage11.ai` strings in it are deliberate leak-detection markers — do not "clean them up".
- The real Turnstile keys **replace** the published always-pass test pair. `.dev.vars` stays untracked.
- The session cookie carries **no `Domain` attribute** — `marquee.stage11.dev` is HSTS-preloaded and a parent-domain cookie would leak. Guardrail G6 asserts it; verify it over the real origin, not just locally.
- Deploying and wiring a public domain is **outward-facing and hard to reverse**. Confirm with Atin before the first real deploy and before any DNS change. He has authorized the credential work, not every consequence of it.
- **Private stays private.** The public competition repo is a separate curated artifact (the orphan `mrq-42-assembly`). Never push `main` to a public remote.

## Two facts that will save you an hour

- **`main` is behind a manual merge gate** — `CODEOWNERS` plus the "main: manual merge gate" ruleset, added by Atin this evening. Any code change goes through a PR he merges. Do not bypass it.
- **Do not run the full test suite.** ~150s, and concurrent full-suite runs wedged this machine at load average 158 earlier tonight. If you need a gate: three `tsc --noEmit` passes, `npx vite build`, `check:design`, `check:api`, `trace:ac`. Push and let GitHub CI run the suite.
- Ports **8787, 8801, 8802, 8803, 8863** are taken. Pick 8804+. If you run `wrangler dev` locally, add `--var INSECURE_LOCAL_COOKIES:1` or a browser will 401 after a 200 login.

## Deadline context

**Wed 2026-08-12 22:00 PT.** The deploy is on the critical path — a deployed site is half the submission. `surface:243` flagged that the login is the one step unblocking a multi-hour chain (resources → migrations → seed → domain → verify), and that discovering a wrong Workers Paid or R2 state is much better tonight than during the final hour. That is exactly why this surface exists now.

## Reporting

Set your c11 title and description immediately (`c11 rename-tab --surface "$C11_SURFACE_ID" "…"`). Update MRQ-57's Lattice status as you go. File anything you learn about Cloudflare back into `~/Projects/Stage11/code/platform/cloudflare.md`.

**Lower your launch flag once you and Atin are actually in conversation** (`c11 lower-flag --surface "$C11_SURFACE_ID"`) — it is up to get his attention, not to stay up. Raise it again only if you are genuinely blocked on him.

Report milestones to **surface:261** (`c11 send --workspace workspace:9 --surface surface:261 "…"`).

Open with a short, concrete first message: what you have read, what you need from him first, and the exact command. Not a plan document — a first step.
