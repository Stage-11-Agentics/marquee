# Marquee — Orchestration Run State

**Staged 2026-08-09 ~02:00. FLEET NOT DISPATCHED — awaiting operator launch word.** Clock rebases at dispatch: CP-1 = D+13h, CP-2 = D+36h, deadline Wed 2026-08-12 22:00 PT.

## Configuration

- **Autonomy:** Moderate (decide-and-log routine; surface architectural/scope/irreversible)
- **N concurrent delegators:** 6 · **Harness:** codex (`codex --yolo`, high effort) per operator directive; orchestrator/validators on claude
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

## Run-time footguns

(rows added during dispatch)
