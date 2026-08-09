# Marquee — Orchestration Run State

**Staged 2026-08-09 ~02:00. FLEET NOT DISPATCHED — awaiting operator launch word.** Clock rebases at dispatch: CP-1 = D+13h, CP-2 = D+36h, deadline Wed 2026-08-12 22:00 PT.

## Configuration

- **Autonomy:** Moderate (decide-and-log routine; surface architectural/scope/irreversible)
- **N concurrent delegators:** 5 (operator-set 2026-08-09; was 6) · **Harness:** codex (`codex --yolo`, high effort) per operator directive; orchestrator/validators on claude
- **PR merge policy:** auto-merge on verified green + fresh this-cycle PASS review; guardrail-adjacent tickets (A-1..A-7 audit track, M-25/26 mirror, auth/M-03) held for orchestrator eyes
- **Git remote (verified):** `forgejo` → ssh://forgejo.stage11.ai:2222/atin/marquee.git (private)
- **Terminal pre-merge status:** `pr_open` (verified in .lattice/config.json stage11 preset)
- **Ticket fidelity:** verbose · **Workflow modes:** fast-track ≤2h mechanical / inline-full default / sub-agent-full for M-02, M-25, M-26, ≥7h tickets
- **Master Validator:** on · **Result Validator:** on · **auto-close surfaces:** on
- **Contract:** SPEC/EVALUATION/BUILDPLAN through Amendment 11; USER_STORIES AC-1–253 (next mint AC-254); binding prototype v1.6; DESIGN.md Flight Deck

## Workspace panes (c11 refs)

- main_view_area: pane:39 (Orchestrator surface:128)
- control_surface: pane:55 (Lattice Board browser surface:193; dashboard port **56248**)
- delegate_view_area_1: pane:56 · delegate_view_area_2: pane:57 (soft cap 15 surfaces/pane; route to lightest)
- operator review browsers: pane:54

## Tickets in scope

Minted by the Mint agent from BUILDPLAN (all `backlog`); authoritative map: `.lattice/orchestration/ticket-map.md`.

## Decision log (append-only)

- 2026-08-09 [moderate] Board staged without dispatch — operator directive ("lay it out, don't launch").
- 2026-08-09 [moderate] Private Forgejo repo `atin/marquee` created + master pushed (signed decision 4); remote name `forgejo`.
- 2026-08-09 [moderate] Lattice init: stage11 preset, project MRQ.
- 2026-08-09 [moderate] v1.6 judgment call (a) ratified: Buildings/Rooms settings cards span full row (legibility over grid-2 symmetry).
- 2026-08-09 [operator] **Fleet launch authorized** — dispatch begins the moment the Mint agent's board passes verification. Orchestrator = surface:128; all build work on codex.
- 2026-08-09 [moderate, operator-delegated] Venue seeding ruled: Sheraton-coherent trio (Sheraton main · Workshop Annex · Online) replaces "real 2025 four" in SPEC Amendment 11; §6 gains the buildings→rooms map. §6 rooms were already Sheraton-native, so this was the only consistent option.
- 2026-08-09 [operator] N concurrent delegators 6 → 5.
- 2026-08-09 [moderate] Ticket consolidation ruled after operator challenged count. True BUILDPLAN board = 72 items (58 feature incl. splits, 11 audits, 3 spikes; earlier "56" was an undercount of the amended plan). Orchestrator's 34–40 target was arithmetically unreachable under its own ≤10h merge cap (~209–258 feature-hours / 10h + 14 unmergeable = floor ~40 at perfect packing). Final rule: 10h cap kept; lever added — same-wave identical-dep pairs may merge across module surfaces; M-04a/b stay split (B-5 protects CP-1 chain); audit track stays standalone (independence is the design). Target high-40s. Mint proceeding without further ack round.

## Run-time footguns

(rows added during dispatch)
