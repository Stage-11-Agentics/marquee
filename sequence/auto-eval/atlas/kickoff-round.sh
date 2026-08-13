#!/bin/zsh -l
# kickoff-round.sh — start round N of the sbek eval on Atlas.
#
#   kickoff-round.sh <round-n> <expected-sha-12>
#   kickoff-round.sh <round-n> --force        # skip the freshness gate; say why in RESULT.md
#
# Lives in the Marquee repo and is pushed to Atlas by `loop.sh fire`, so the
# version that runs is the version under review rather than whatever was last
# hand-edited on the box.

set -euo pipefail
KIT=~/Projects/sbek-eval-kit
cd "$KIT"

round="${1:?usage: kickoff-round.sh <round-n> <expected-sha-12>|--force}"
expected="${2:?usage: kickoff-round.sh <round-n> <expected-sha-12>|--force}"

live=$(curl -fsS --max-time 15 https://marquee.stage11.dev/health \
       | python3 -c 'import sys,json; print(json.load(sys.stdin)["build"])')

if [[ "$expected" != "--force" ]]; then
  if [[ "$live" != "$expected" ]]; then
    print -u2 "REFUSING: live is $live, you expected $expected."
    print -u2 "A round scored against a stale build measures work the fleet already"
    print -u2 "finished — the worst kind of wasted hour. Deploy first (DEPLOY.md)."
    exit 1
  fi
fi
print "live build: $live"

# The mission is per-round when one exists and falls back to round 4's, which is
# written generically apart from the two coverage gaps it calls out by name.
mission="$KIT/MISSION-round${round}.md"
[[ -r "$mission" ]] || mission="$KIT/MISSION-round4.md"
[[ -r "$mission" ]] || { print -u2 "no mission file for round $round"; exit 1 }
print "mission: ${mission:t}"

# submissionNotes must describe the build actually being shipped — a stale claim
# steers the browsing agent away from evidence and costs real points. The
# coordinator regenerates evalconfig.json before firing; this only records what
# it is about to run against.
[[ -f evalconfig.json ]] || { print -u2 "missing evalconfig.json"; exit 1 }
cp -f evalconfig.json "evalconfig.pre-round${round}.$(date -u +%Y%m%dT%H%M%SZ).json"

prev=$(( round - 1 ))
[[ -f PROGRESS.log ]] && mv PROGRESS.log "PROGRESS.round${prev}.log"
print "round $round starting against $live" > PROGRESS.log

~/bin/atlas-job run "sbek-round${round}" "$KIT" "$mission" \
  -- --model opus --dangerously-skip-permissions --mcp-config .mcp.json

print
print "watch:  ssh atlas 'tail -f ~/Projects/sbek-eval-kit/PROGRESS.log'"
print "status: ssh atlas '~/bin/atlas-job status sbek-round${round}'"
