# Evaluating Marquee with sbek

`sbek` is swyx's grading harness for the "Kill My SaaS" competition: 98 rubric items,
20 scenarios, 7 areas, area-weighted to 100. The kit lives at `.eval-kit-agent/`
(its own git checkout, ignored by this repo). Everything below runs from that
directory. Orient there first: its `AGENTS.md` is the full workflow contract.

## Before any run, either way

- `evalconfig.json` — `url` is the target; `submissionNotes` is injected into every
  scenario brief and **must describe the build actually deployed**. A stale claim
  ("X is not implemented") steers the browsing agent away from evidence and costs
  real points. Verify notes against `curl <url>/health` before starting.
- Marquee needs no login: the landing page mints organizer/reviewer/speaker seats in
  one click. `.auth/` stays empty; never run `sbek auth`.
- Coverage is an adversary: below 60% of rubric weight judged, the headline score is
  withheld. `cannot_judge` (run never got there) drains coverage; `not_found`
  (product lacks it) scores zero. Confusing the two is the worst available mistake.
- **After scoring: mandatory manual cleanup.** The run fills the live demo with the
  DevFlow Conf fixture. Enter the organizer seat and click **Reset demo**, then
  verify the header reads "AI Engineer New York 2026" again.

## Path A — in-context (no API key; a Claude Code session is agent and judge)

Open the session in `.eval-kit-agent/` so the local-scope `sbek` MCP server and the
`sbek-browse` / `sbek-judge` project skills load.

1. `npx --no-install tsx src/cli.ts plan --url <url> --areas <a,b,...>` creates the
   run dir and checklist.
2. **Browse single-lane, in spec order.** This is irreducibly sequential: scenarios
   verify data created by earlier ones (CFP-S3 checks CFP-S2's submissions) and
   areas chain (accepted talks → sessions → agenda → widgets) against one mutable
   live site. Do not run two browsers. Drive `start_scenario → snapshot → act by
   ref → screenshot/observe → done`, ~70 tool calls per scenario.
3. **Pipeline the judging.** The moment an area's last scenario is `done`, dispatch
   that area's judge as a background subagent (fresh context — the browser's memory
   of intent is the bias the harness is designed to exclude). Each judge runs
   `judge-brief --area <slug>`, reads **every** listed screenshot, and lands its
   verdicts via `scripts/judge-submit.sh claim|submit` — atomic, refuses
   double-writes, safe to re-dispatch. Five of six areas finish judging before
   browsing does. The dispatch prompt must state (verified pitfalls, 2026-08-12):
   - cwd is `.eval-kit-agent` — both `judge-brief` and `judge-submit.sh` break
     elsewhere; screenshot paths print **run-dir-relative**, so prefix
     `runs/<stamp>/` before reading.
   - "(ATTACHED below)" in the brief is aspirational in CLI mode — no pixels are in
     the text. The judge must Read each image file itself or it judges from prose.
   - `judge-brief` emits ~70 KB; redirect to a file and read in chunks — `head`
     silently drops later scenarios' evidence.
   - `defects[]` entries need `{severity: critical|major|minor, description, where}`.
4. Sweep `runs/<stamp>/judgements/` for six files, then
   `npx --no-install tsx src/cli.ts score`. Missing areas score as `cannot_judge`,
   so gaps are visible, not silent.

Wall-clock ≈ browse time + one judge (~3h for the six required areas). Mid-run
deploys happen; snapshot `/health` at area boundaries and record drift in
`area_notes`, don't restart.

## Path B — official (API-driven agent and judge)

```sh
pnpm run sbek -- run --url <url> [--areas a,b,c] [--resume <run dir>]
```

Requires `ANTHROPIC_API_KEY`. `src/agent.ts` drives the browser and `src/judge.ts`
grades, as API models — no session context, closest to how the competition itself
grades. `--resume` reuses completed scenarios and scored areas. `--dry-run`
validates specs without spending anything. Same run-dir contract, same `score`
output, same cleanup obligation.

## Shared tail

`score` writes `report.json` / `report.html` / `manual-checklist.md`. Manual items
(emails arriving, calendar exports, cross-account visibility) need a human:
fill `manual-results.json`, then `finalize --run runs/<stamp>` folds them in.
