# Mission: Apply Adversarial Fixes — Marquee

You are the **amendment editor**. `sequence/research/contract-adversarial.md` contains 8 BLOCKING and 22 FIX findings against Marquee's build contract, each with a concrete fix written by the reviewer. Your job: **apply the written fixes exactly — you are hands, not a designer.** Where a fix says precisely what to change, change precisely that. Where applying it surfaces a judgment call the reviewer didn't settle, stop on that item and report it; never invent semantics.

## c11 etiquette (first)

Load the c11 skill. Tab pre-named **"Editor"**; keep it. Last description line: `Lineage: Marquee Initiation → Editor`.

## Order of work

1. **Read** `contract-adversarial.md` fully, then the target files: `EVALUATION.md`, `SPEC.md`, `BUILDPLAN.md`, `sequence/USER_STORIES.md`.
2. **Apply all 8 BLOCKING fixes** (B-1 – B-8) exactly as their Fix paragraphs specify — including B-5's schedule rebase (express checkpoints as *dispatch + N hours*, per its option (a), AND apply the M-04a/M-04b split from option (b) — the reviewer offered either; the orchestrator chooses **both**: rebased clock and the shorter chain) and B-6's new §8 orphan-commit step + `check:repo` denylist extension.
3. **Verify the arithmetic after B-1:** AC counts, tier tallies, tag census, and every "append from AC-…" pointer must agree across all four files (next mint: **AC-251**). Run a grep sweep for stale "AC-250" append-pointers.
4. **Commit** as one commit: `Apply adversarial BLOCKING fixes B-1..B-8`.
5. **Then apply the 22 FIX items** that are unambiguous contract edits, in the reviewer's order. Any FIX item that requires new design judgment, touches the prototype, or conflicts with a signed client ruling: **skip it and list it**. Commit as: `Apply adversarial FIX items (contract-level)`.
6. Amend each applied finding in `contract-adversarial.md` with `→ APPLIED` (or `→ SKIPPED: <reason>`); include in the second commit.

## Report

`c11 send --workspace workspace:16 --surface surface:128 "Editor: done — 8/8 BLOCKING applied, <N>/22 FIX applied, <N> skipped needing judgment: <ids>. Commits: <shas>"`. Do not touch the prototype, the dossiers, or run-state. Do not renumber any existing AC.
