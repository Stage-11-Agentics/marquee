# MRQ-43 — public-history audit checklist

Ticket: MRQ-43
Actor: agent:auditor-mrq-43
Worktree: /Users/atin/Projects/Stage11/deployments/Marquee-worktrees/mrq-43-audit-repo
Audit branch HEAD: 96a0679697a6b953e74a70d933e7e04d88d2fb49
Pushed ref checked: forgejo/mrq-43-audit-repo at the same SHA

## Verdict

This is an audit of the private working history, not a claim that the
working tip is publishable. The working tree intentionally contains the
orchestration board, research sources, and operator evidence. MRQ-42 must
assemble the public orphan first, then rerun this checklist against that
orphan and the pushed public remote.

The assembled-orphan scan is NOT RUN: lattice show MRQ-42 reports status
backlog and there is no MRQ-42/public/orphan/assembly ref in the fetched
Forgejo refs. No clean result is claimed for that gate.

The pushed-remote scan DID RUN against forgejo/mrq-43-audit-repo:

    npm run check:repo -- --repo . --ref forgejo/mrq-43-audit-repo

Observed result: exit 1; status fail; commit
96a0679697a6b953e74a70d933e7e04d88d2fb49; fullHistory true; 96 findings.
The report contains 83 denied-history-path entries (the checker repeats paths
from repeated objects), 11 denied-history-content labels, missing-license, and
gitleaks-unavailable. The README/extension findings cleared when the audit
branch rebased onto MRQ-40's merged README commit.

The bare command also exits 1 with:

    Error: check:repo requires explicit --repo and --ref publish targets

That is correct fail-closed behavior and is not a defect: a publish target is
required so the private working repository is not mistaken for the public
tree.

## Blocking secret-scan result

No gitleaks scan has executed on this machine.

    command -v gitleaks
    [no output]

The same absence was confirmed with type/brew checks by the operator. At
scripts/checks/check-repo.mjs:47-49, the checker invokes gitleaks but converts
code 127 into the gitleaks-unavailable finding. This fails the report, but it
does not establish that the tree has zero secrets.

The Marquee ruleset is NOT sufficient for gate 16. At
scripts/checks/repo-policy.mjs:1-36 it checks five denied path patterns and
content strings for private paths, Stage 11, Forgejo, tailnet, Lattice,
delegator, orchestrator, Atin, C11, surface, and workspace. It does not
provide general token, API-key, password, entropy, private-key, or provider
coverage. .gitleaks.toml:1-10 contains one Marquee Cloudflare token-like rule
plus the defaults that only gitleaks would execute.

Therefore gitleaks is a genuine operator prerequisite before gate 16. Do not
install or work around it in MRQ-43. The operator must make a real gitleaks
binary available, record its version, and run it against the assembled orphan
and pushed remote. A Marquee-only pass cannot be reported as zero-secret
proof.

An independent full-history assignment regex found only the documented local
placeholders `.dev.vars.example:11-12`:

    UPLOAD_TOKEN_SECRET=local-fake-upload-token-secret
    UPLOAD_RATE_LIMIT_SECRET=local-fake-upload-rate-limit-secret

It found no credential-shaped production value. The source also contains
`src/jobs/mail/consumer.ts:100`, `const apiKey = env.RESEND_API_KEY`, but that
is an environment-variable read with no secret value. This is useful negative
evidence only; it is not a replacement for gitleaks.

## Mechanical MRQ-42 assembly checklist

The public orphan MUST reject every item below. Use both the current tree path
walk and all historical commit path names; do not rely on a deduplicated object
list alone.

### Hard path exclusions

1. Exclude .lattice/** in its entirety. The tip has 787 .lattice path names,
   and the complete commit/path walk also has 787 unique .lattice names.
   This includes, at minimum:

   - .lattice/orchestration/**
   - .lattice/events/**
   - .lattice/tasks/**
   - .lattice/plans/**
   - .lattice/artifacts/**
   - .lattice/config.json
   - .lattice/context.md
   - .lattice/ids.json

   A stranger who clones the public repo and runs git log or opens any of
   these paths can read task descriptions, prompts, actor IDs, review
   evidence, PR references, and orchestration state.

2. Exclude sequence/research/** unless MRQ-42 creates an explicit, reviewed
   allowlist. There are 32 research paths at the tip; the current contract
   says the research dossiers, sources tree, and agent briefs are not public.

3. The exact 24 denied path names in the complete commit/path walk are:

   .lattice/orchestration/run-state.md
   sequence/run-state.md
   sequence/research/briefs/AGENT-BRIEF-adversarial-pass.md
   sequence/research/briefs/AGENT-BRIEF-amendment-editor.md
   sequence/research/briefs/AGENT-BRIEF-api-comparison.md
   sequence/research/briefs/AGENT-BRIEF-board-mint.md
   sequence/research/briefs/AGENT-BRIEF-contract-draft.md
   sequence/research/briefs/AGENT-BRIEF-discord-intel.md
   sequence/research/briefs/AGENT-BRIEF-eval-draft.md
   sequence/research/briefs/AGENT-BRIEF-landscape-features.md
   sequence/research/briefs/AGENT-BRIEF-seams-feasibility.md
   sequence/research/briefs/AGENT-BRIEF-seed-source.md
   sequence/research/briefs/AGENT-BRIEF-stakeholders-stories.md
   sequence/research/sources/AGENT-BRIEF-competition-research.md
   sequence/research/sources/aie-summit-2025-program.json
   sequence/research/sources/brief-image1.png
   sequence/research/sources/competition-brief-full.pdf
   sequence/research/sources/competition-brief.md
   sequence/research/sources/competitor-context-doc-2026-08-08.md
   sequence/research/sources/sessionboard-kb-urls.txt
   sequence/research/sources/tweet-image.png
   sequence/research/sources/walkthrough-transcript.txt
   sequence/research/sources/walkthrough.en-orig.vtt
   sequence/research/sources/walkthrough.en.vtt

4. Apply these path regexes to every historical path name, not just the tip:

   (^|/)sources/
   \.pdf$
   (^|/)competitor-[^/]*
   (^|/)AGENT-BRIEF-[^/]*
   (^|/)run-state(\.[^/]*)?$
   (^|/)Atin/

### Hard content exclusions

Apply these patterns to every text blob in every commit reachable from the
publish ref:

    /Users/
    Stage[- ]?11
    forgejo.stage11.ai
    tailnet
    word-boundary Lattice
    word-boundary delegator
    word-boundary orchestrator
    C11_[A-Z0-9_]+
    surface:[0-9]+
    workspace:[0-9]+
    (^|/)Atin/

Concrete current matches and their publication failures include:

- sequence/USER_STORIES.md:905 and
  sequence/research/briefs/AGENT-BRIEF-landscape-features.md:5,
  sequence/research/briefs/AGENT-BRIEF-seams-feasibility.md:5,
  sequence/research/briefs/AGENT-BRIEF-stakeholders-stories.md:5, and
  sequence/research/sources/AGENT-BRIEF-competition-research.md:5 contain
  /Users/atin/... paths. A stranger can recover local worktree locations from
  the public clone.
- prototypes/skins/SKIN-BRIEF.md:26 contains c11 workspace:16 and surface:128.
  A clone exposes internal c11 topology and operator routing.
- sequence/OPERATOR-PRECONDITIONS.md:192 contains workspace:9 and surface:60;
  the same file has internal account instructions.
- BUILDPLAN.md:343 and sequence/research/briefs/AGENT-BRIEF-board-mint.md:1
  contain Lattice vocabulary; README.md:20 contains delegator; and
  scripts/seed/index.ts:3 contains Seed orchestrator. These are orchestration
  implementation details, not public product documentation.
- src/jobs/calendar/ics.ts:237 emits
  PRODID:-//Stage 11//Marquee//EN. A caller requesting an ICS invite causes a
  real calendar payload to disclose the internal program name.
- src/routes/landing.route.tsx:162 links to
  github.com/Stage-11-Agentics/marquee, and
  tests/integration/landing.test.ts:57 locks that internal organization into
  the public landing page contract.

### Real email addresses

Reject real addresses unless they are the sanctioned
firstname.lastname@example.com form. The following are observed real or
operator-owned addresses and must not survive the orphan:

- sequence/OPERATOR-PRECONDITIONS.md:21, :40, and :69 contain
  projects@stage11.ai.
- sequence/OPERATOR-PRECONDITIONS.md:25 contains atin@atin.me.
- sequence/OPERATOR-PRECONDITIONS.md:144 contains
  benevolent.futures@gmail.com.
- BUILDPLAN.md:16, :175, and :270; EVALUATION.md:670; SPEC.md:38;
  sequence/PRODUCT-DEFINITION.md:65; sequence/USER_STORIES.md:698;
  sequence/research/competition-requirements.md:391;
  sequence/research/seams-feasibility.md:23, :271, and :479;
  sequence/run-state.md:28, :57, and :99; spikes/s2-ics-clients/VERDICT.md:25
  and :30; spikes/s2-ics-clients/send.mjs:4, :5, :112, and :129;
  src/jobs/calendar/ics.ts:5; src/jobs/calendar/invites.ts:127;
  src/jobs/mail/consumer.ts:9; and
  tests/unit/calendar-ics.AC-95-96-97.test.ts:18 and :50 contain
  marquee@stage11.systems.

Concrete reproduction: a stranger runs git grep for @stage11.ai,
@atin.me, @stage11.systems, or benevolent.futures@gmail.com, or a caller
requests an invite. The clone reveals the operator account/personal address,
the real inbox used by the validation spike, or the sender address emitted by
the application.

### Third-party material and images

Exclude every sequence/research/sources/** path and the broader denied paths
above. Visual inspection confirmed:

- sequence/research/sources/brief-image1.png:1 is a 2048x846 Sessionboard.com
  screenshot with visible third-party branding and the visible address
  swyx@ai.engineer.
- sequence/research/sources/tweet-image.png:1 is a 1374x912 budget/source
  screenshot containing third-party material.
- sequence/research/sources/competition-brief-full.pdf:1 is the archived
  competition brief; competitor-context-doc-2026-08-08.md is a rival
  document. These are redistribution findings even when no secret detector
  flags them.

The committed Sessionize URLs at fixtures/sessionize/speakers.csv:2-3 and
tests/integration/api/sessionize-import.AC-110-113.test.ts:85 use the
example.test placeholder domain, not real headshots. They are not evidence of
a real person image. Separately, the application intentionally has an
external image dependency:

- src/ui/venues/VenueMap.tsx:28 fetches
  https://tile.openstreetmap.org/{ZOOM}/{x}/{y}.png.
- prototypes/pipeline-v1.1/index.html:2638 contains the same OSM tile URL.

Concrete caller input is opening the venue map; the browser then requests
external OSM image tiles. This is not a committed headshot or secret, but it
must remain an explicit product/dependency allowlist decision rather than
being mistaken for a self-contained public artifact.

## Checker coverage caveat

scripts/checks/check-repo.mjs:27-35 currently obtains denied paths from
git rev-list --objects. That output is object-deduplicated. The command
reported 23 denied path names and omitted
sequence/research/sources/walkthrough.en.vtt because it shares a blob with
walkthrough.en-orig.vtt. A complete path scan using
git log --full-history --format= --name-only plus git ls-tree -r --name-only
returned all 24 names above. MRQ-42 should use the complete path walk when
assembling and verifying the orphan; do not treat the check's 83 repeated
path entries as a unique-path count.

## Automated guard added by MRQ-43

Commit 96a0679 (rebased from the audit change) adds a fast tests/node guard for the recurring internal
publication vocabulary gap. It adds Forgejo, tailnet, Lattice, delegator, and
orchestrator patterns to scripts/checks/repo-policy.mjs and a fixture test
that rejects all five from history. Direct result:

    3 tests passed; 0 failed

This is scanner protection only. It does not clean or alter the product tip.

## Clean coverage actually checked

- Exact cwd guard passed.
- Branch was rebased onto the current forgejo/master before the final scan;
  npm ci completed after each rebase.
- 227 reachable commits and 4018 rev-list objects at the final audit HEAD.
- Current tree and complete historical path names checked with git ls-tree and
  git log --full-history --name-only.
- Current and historical text searched for credential-shaped literals,
  internal hosts, Stage 11/Lattice/orchestration terms, C11 IDs, /Users paths,
  real email domains, and external image URLs.
- No tailnet name literal or Atin/ path object was found; /Users/ content was
  found as listed above.
- No credential-shaped value was found by the independent regex scan, but
  gitleaks did not execute, so this category is not clean.
- check:repo was run on the pushed ref and reported fullHistory true. It was
  not run on an assembled orphan because no such ref exists yet.
- MRQ-43 owns no auto AC; no tests/ac-claims/MRQ-43.json was created.
