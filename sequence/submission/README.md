# Submission asset pack

Everything the "$10,000 Kill My SaaS" submission form could plausibly ask for,
pre-written and ready to paste. The form arrives in Discord; the goal is that
filling it in takes five minutes of copy-paste, not an hour of writing at
21:45 PT.

Every factual claim in this pack was verified against the deployed site
(build `1f53732201aa`) on 2026-08-12. If a deploy lands after that, re-run the
checks each file cites — most are one `curl`.

| File | What it answers |
|---|---|
| [IDENTITY.md](IDENTITY.md) | Name, one-liner, 50/150/300-word descriptions |
| [JUDGE-QUICKSTART.md](JUDGE-QUICKSTART.md) | The walkthrough loop in the video's order — exact URLs, seats, expectations |
| [SUBMISSION-NOTES.md](SUBMISSION-NOTES.md) | The `submissionNotes` field the grading harness injects into every scenario — the single highest-leverage paste |
| [FEATURE-COVERAGE.md](FEATURE-COVERAGE.md) | The brief's six features + three struck items, honestly graded with R-numbers |
| [BONUS-CLAIMS.md](BONUS-CLAIMS.md) | Cloudflare, API, speed claimed with evidence; Airtable and Forge plainly forfeited |
| [DIFFERENTIATORS.md](DIFFERENTIATORS.md) | Eight things nobody asked for, each checkable in under a minute |
| [LIMITATIONS.md](LIMITATIONS.md) | What is not built and what is rough — any subset is paste-ready; the final section is internal |
| [STACK.md](STACK.md) | The architecture in a paragraph, plus the numbers a technical judge can check |

Likely form fields → files: *project name / description* → IDENTITY ·
*how do we test it* → JUDGE-QUICKSTART · *notes for the evaluation* →
SUBMISSION-NOTES · *what did you build / features* → FEATURE-COVERAGE ·
*bonuses* → BONUS-CLAIMS · *what makes it different* → DIFFERENTIATORS ·
*known gaps* → LIMITATIONS (operator's choice) · *stack* → STACK.
Repo URL: https://github.com/Stage-11-Agentics/marquee · Live site:
https://marquee.stage11.dev · License: Apache-2.0.
