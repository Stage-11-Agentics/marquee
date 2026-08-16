#!/usr/bin/env bash
# loop.sh — the auto-eval spine. A verb toolbox, not a daemon.
#
# Shell owns mechanism and guards; the coordinator agent owns judgement and calls
# these verbs. Everything durable lives in files, so a coordinator that dies
# mid-run is replaced by reading state, not by remembering it.
#
#   loop.sh status | sync | watch | mine | guard | barrier | fire <sha>
#
# See README.md for the structure and the rules these verbs enforce.

# -E (errtrace) is load-bearing, not decoration: without it an ERR trap set
# inside a function is NOT inherited by the functions that function calls, so
# cmd_fire's cleanup trap never runs when the kickoff refuses inside atlas() —
# errexit kills the script first and the deploy freeze is left on the whole
# fleet with no diagnostic. tests/node/auto-eval-guards.test.mjs proves it.
set -Eeuo pipefail

# --- configuration ---------------------------------------------------------
MARQUEE_ROOT=${MARQUEE_ROOT:-/Users/atin/Projects/Stage11/deployments/Marquee}
KIT_LOCAL=${KIT_LOCAL:-$MARQUEE_ROOT/.eval-kit-agent}
# Remote paths are home-relative: ssh expands ~ itself, rsync defaults to $HOME.
KIT_ATLAS=${KIT_ATLAS:-Projects/sbek-eval-kit}
DEPLOY_TREE=${DEPLOY_TREE:-/Users/atin/Projects/Stage11/deployments/Marquee-worktrees/deploy-freshness}
SITE=${SITE:-https://marquee.stage11.dev}
SELF_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE_DIR=${STATE_DIR:-$SELF_DIR/run}
STATE="$STATE_DIR/state.json"
CREDENTIALS_ENV=${CREDENTIALS_ENV:-$HOME/Projects/Stage11/code/platform/.credentials/.env}
DEMO_HEADER=${DEMO_HEADER:-AI Engineer New York 2026}
# The fleet-wide deploy freeze (check-deploy.mjs). It reads the marker from the
# current worktree root or MARQUEE_PRIMARY_CHECKOUT, so the primary checkout is
# where it belongs: findable from every worktree, including the deploy tree.
FREEZE_FILE=${FREEZE_FILE:-$MARQUEE_ROOT/.deploy-freeze}
# Score-floor: a round may lose this many points before the loop stops deploying.
FLOOR_DROP=${FLOOR_DROP:-2.0}
# Seconds between watch ticks. Injectable so the completion contract can be
# tested: proving it takes two consecutive `stopped` readings, and at 45s real
# seconds that is a 45-second test inside a 45-second suite budget.
WATCH_INTERVAL=${WATCH_INTERVAL:-45}

mkdir -p "$STATE_DIR"
[[ -f $STATE ]] || echo '{"round":0,"anchor":null,"anchorPct":null,"runStamp":null,"sha":null,"halted":false}' > "$STATE"

say() { printf '\033[36m::\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Note the None check rather than truthiness: round 0 and halted=false are real values.
jget() { python3 -c "import json;v=json.load(open('$STATE')).get('$1');print('' if v is None else v)"; }
jset() {
  python3 - "$@" <<'PY'
import json,sys
path=sys.argv[1]; d=json.load(open(path))
for kv in sys.argv[2:]:
    k,_,v=kv.partition('=')
    try: v=json.loads(v)
    except Exception: pass
    d[k]=v
json.dump(d,open(path,'w'),indent=2)
PY
}
set_state() { jset "$STATE" "$@"; }

atlas() { ssh atlas "$*"; }

live_sha() { curl -fsS --max-time 15 "$SITE/health" | python3 -c 'import sys,json;print(json.load(sys.stdin)["build"])'; }

# A run that was stopped short, graded more than one build, or is otherwise not
# attributable. Recorded in state so nothing can quietly use it: a void run is
# indistinguishable from a good one on disk — same judgements, same shape — and
# diffing against one manufactures regressions that were never real.
is_void() {
  python3 -c "
import json,sys
print('yes' if '$1' in json.load(open('$STATE')).get('voidRuns',[]) else 'no')"
}

# The newest run directory on Atlas, whether or not it has been synced yet.
atlas_run_stamp() { atlas "ls -1t ~/$KIT_ATLAS/runs | head -1"; }

# Job names follow the round: sbek-round5, sbek-round6, ... Round 0 means nothing
# has been fired through this spine yet, so fall back to the round-4 job that
# seeded it.
job_name() { local r; r=$(jget round); [[ -n $r && $r != 0 ]] && echo "sbek-round$r" || echo "sbek-round4"; }

# Ask Atlas for job state, keeping "not running" and "could not ask" apart.
# Piping ssh into grep loses that distinction: a dropped link prints nothing,
# grep returns 1, and the caller reads silence as "idle". Both callers respond
# to idle by mutating the thing a round is measuring, so the difference is the
# whole guard. Prints: running | stopped | unreachable.
job_state() {
  local out rc
  out=$(ssh -o BatchMode=yes -o ConnectTimeout=15 atlas \
        "~/bin/atlas-job status ${1:-} 2>/dev/null" 2>/dev/null); rc=$?
  (( rc != 0 )) && { echo unreachable; return 0; }
  [[ -z ${out//[[:space:]]/} ]] && { echo unreachable; return 0; }
  case "$out" in
    *RUNNING*) echo running;;
    *)         echo stopped;;
  esac
}

# Ground truth for "is a round in flight", asked of Atlas rather than inferred from
# our own state. A round fired by another agent — which is exactly how round 5
# started — is invisible to state.json but very much real.
#
# FAILS CLOSED. An unreachable Atlas reports "a round is running", because the
# callers are cmd_barrier (which resets the demo and deploys) and cmd_fire
# (which starts a second round against one mutable site). Refusing wrongly costs
# a retry; proceeding wrongly costs the round, which is the failure that voided
# four of the first eight. tests/node/auto-eval-guards.test.mjs pins it.
round_running() {
  local state; state=$(job_state)
  [[ $state == running || $state == unreachable ]]
}

# --- verbs -----------------------------------------------------------------

cmd_status() {
  local stamp; stamp=$(jget runStamp); [[ -n $stamp ]] || stamp=$(atlas_run_stamp)
  local judged; judged=$(atlas "ls -1 ~/$KIT_ATLAS/runs/$stamp/judgements 2>/dev/null | wc -l" | tr -d ' ')
  local job; job=$(atlas "~/bin/atlas-job status $(job_name) 2>/dev/null | head -1" || echo "unknown")
  printf 'round      %s%s\n' "$(jget round)" "$([[ $(jget halted) == True ]] && echo '  [HALTED]' || true)"
  printf 'live sha   %s\n' "$(live_sha)"
  printf 'anchor     %s (%s%%)\n' "$(jget anchor)" "$(jget anchorPct)"
  printf 'run        %s — %s/6 areas judged%s\n' "$stamp" "$judged" \
    "$([[ $(is_void "$stamp") == yes ]] && echo '   [VOID — do not cite]' || true)"
  printf 'atlas job  %s\n' "$job"
  atlas "tail -4 ~/$KIT_ATLAS/PROGRESS.log"
}

cmd_sync() {
  local stamp=${1:-$(atlas_run_stamp)}
  say "rsync runs/$stamp from Atlas"
  # Screenshots are the point: (b) vs (c) is decided from pixels, not prose.
  # Plain -a only: macOS ships openrsync, which has no --info.
  rsync -a "atlas:$KIT_ATLAS/runs/$stamp/" "$KIT_LOCAL/runs/$stamp/"
  set_state "runStamp=\"$stamp\""
  echo "$KIT_LOCAL/runs/$stamp"
}

# Blocks, printing one line per newly-landed area judgement. The coordinator
# reads these lines and dispatches an analyst per area.
cmd_watch() {
  local stamp=${1:-$(atlas_run_stamp)}
  local seen=" "
  local stopped=0
  say "watching runs/$stamp for area judgements (ctrl-c to stop)"
  while :; do
    local now
    now=$(atlas "ls -1 ~/$KIT_ATLAS/runs/$stamp/judgements 2>/dev/null" | sed 's/\.json$//') || true
    for area in $now; do
      case "$seen" in *" $area "*) continue;; esac
      seen="$seen$area "
      # A dropped link must not end the watch: under set -e an unguarded rsync
      # takes the whole loop down, and a dead watch looks exactly like a quiet
      # one. Observed live in round 9 — the watch exited 255 mid-round and a
      # judgement landed unnoticed.
      cmd_sync "$stamp" >/dev/null 2>&1 || say "sync failed for $area — retrying next tick"
      printf 'JUDGEMENT %s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$area" "$KIT_LOCAL/runs/$stamp"
    done
    # Run over? Two consecutive "stopped" readings, then one last sync and stop.
    # Never on "unreachable": RUN-COMPLETE is the signal the coordinator acts on
    # to score and barrier, so announcing it because the link dropped walks the
    # whole loop from "still browsing" to "demo reset and deployed".
    case "$(job_state "$(job_name)")" in
      running)     stopped=0;;
      unreachable) stopped=0; say "atlas unreachable — still watching, NOT completing";;
      stopped)
        stopped=$(( stopped + 1 ))
        if (( stopped >= 2 )); then
          cmd_sync "$stamp" >/dev/null 2>&1 || true
          # "No process" is not "finished". A completed run leaves report.json
          # behind; a killed one leaves the run directory it was halfway through.
          # Two consecutive `stopped` readings prove only that nothing is running
          # now — and `job_state` answers `stopped` for a job that never existed,
          # a job that crashed, and a job that finished, identically.
          #
          # The README hardened this loop against the mirror image: a dead watch
          # looks exactly like a quiet one, which is why we never complete on
          # `unreachable`. This is the other half — a dead job looks exactly like
          # a finished one. Observed on round 12: Atlas hung mid-round and
          # rebooted, the job died at 14 of 20 scenarios with three of seven areas
          # judged, and the watch announced RUN-COMPLETE. That announcement is the
          # signal the coordinator acts on, and its protocol is
          # RUN-COMPLETE → sync → score → guard → barrier, so a false completion
          # walks straight into scoring a partial run, setting an anchor from it,
          # and deploying on the result.
          if atlas "test -f ~/$KIT_ATLAS/runs/$stamp/report.json"; then
            printf 'RUN-COMPLETE %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stamp"
            return 0
          fi
          printf 'RUN-DIED %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stamp"
          die "the job is gone and runs/$stamp has no report.json — it was KILLED, not finished.
Do not score, guard or barrier on this run. Record it as void first:
  python3 - <<'PY'
import json; p='$STATE'; d=json.load(open(p))
d['voidRuns'].append('$stamp'); d['runStamp']=None
json.dump(d, open(p,'w'), indent=2)
PY
Judgements already on disk graded one build and stay valid per-area; the HEADLINE is void."
        fi;;
    esac
    sleep "$WATCH_INTERVAL"
  done
}

cmd_mine() {
  local stamp; stamp=$(jget runStamp); [[ -n $stamp ]] || die "no synced run; run: loop.sh sync"
  local baseline=""
  if [[ ${1:-} == --baseline ]]; then
    [[ $(is_void "$2") == yes ]] && die "REFUSING: $2 is a void run. Diffing against it
invents regressions. Use the last run that graded a single build end to end."
    baseline="--baseline $KIT_LOCAL/runs/$2"
  fi
  (cd "$KIT_LOCAL" && node "$SELF_DIR/mine.mjs" --kit . --run "runs/$stamp" $baseline)
}

# The safety property. Compares this round against the anchor (best round so far)
# and refuses to let the loop deploy into a falling score.
cmd_guard() {
  # Prefer the harness's own area-weighted headline over mine.mjs's flat-weight
  # approximation. They differ by more than a point — round 4 read 88.1 official
  # against 86.9 flat — and the floor has to guard the number the competition
  # reads. mine.mjs is the fallback for a round scored but not yet finalised.
  local pct stamp; stamp=$(jget runStamp)
  pct=$(python3 -c "
import json,sys
d=json.load(open('$KIT_LOCAL/runs/$stamp/report.json'))
if d.get('scoreWithheld'): sys.exit(1)
print(d['overallPct'])
" 2>/dev/null) \
    || pct=$(cmd_mine | python3 -c 'import sys,json;print(json.load(sys.stdin)["headline"]["pct"])')
  local anchor_pct; anchor_pct=$(jget anchorPct)
  say "round pct $pct  anchor $anchor_pct"
  if [[ -z $anchor_pct ]]; then
    set_state "anchor=\"$(live_sha)\"" "anchorPct=$pct"
    say "anchor set: $(live_sha) at $pct%"
    return 0
  fi
  local drop; drop=$(python3 -c "print(round($anchor_pct - $pct, 2))")
  if (( $(python3 -c "print(1 if $drop > $FLOOR_DROP else 0)") )); then
    set_state "halted=true"
    die "SCORE FLOOR: $pct% is ${drop} below anchor $anchor_pct% ($(jget anchor)).
Loop halted — no further deploys. Roll back with:
  git revert / checkout $(jget anchor) && loop.sh barrier --deploy-only
Then raise a flag for the operator."
  fi
  if (( $(python3 -c "print(1 if $pct > $anchor_pct else 0)") )); then
    set_state "anchor=\"$(live_sha)\"" "anchorPct=$pct"
    say "new anchor: $(live_sha) at $pct%"
  fi
}

# THE mutation window. The only place anything about the target changes.
cmd_barrier() {
  [[ $(jget halted) == True ]] && die "loop is halted; clear state.halted after an operator call"

  # The hard gate. Everything below this line mutates the thing a running round is
  # measuring: the reset wipes its data, the deploy moves its target. The freeze
  # marker is a convention between agents and can be stale or absent; the job
  # status cannot. Ask Atlas, always, and refuse.
  if [[ ${1:-} != --force ]]; then
    case "$(job_state)" in
      running)
        die "REFUSING: a round is in flight on Atlas.
The barrier resets the demo and deploys — both destroy a measurement in progress.
Wait for RUN-COMPLETE (loop.sh watch), then run this again.
  ssh atlas '~/bin/atlas-job status'";;
      unreachable)
        die "REFUSING: cannot reach Atlas to ask whether a round is in flight.
That is NOT the same as 'no round is running'. The barrier resets the demo and
deploys, so it must not proceed on an unanswered question.
  ssh atlas '~/bin/atlas-job status'";;
    esac
  fi

  # The barrier is the only thing that lifts the freeze. `fire` declares it, and
  # between those two points every other agent's check:deploy reads "frozen, do
  # not deploy" — which is what stops a well-behaved sibling from destroying a
  # measurement by following DEPLOY.md correctly.
  if [[ -f $FREEZE_FILE ]]; then
    say "0/5 lifting the deploy freeze: $(head -1 "$FREEZE_FILE")"
    rm -f "$FREEZE_FILE"
  fi

  say "1/5 reset the demo to its seeded baseline"
  local jar; jar=$(mktemp)
  curl -fsS -c "$jar" -X POST "$SITE/api/v1/auth/demo" \
    -H 'content-type: application/json' -d '{"role":"organizer"}' >/dev/null
  local job
  job=$(curl -fsS -b "$jar" -X POST "$SITE/api/v1/admin/reset-demo" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["job_id"])')
  for _ in $(seq 1 60); do
    local st
    st=$(curl -fsS -b "$jar" "$SITE/api/v1/admin/reset-demo/$job" \
         | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')
    [[ $st == done ]] && break
    [[ $st == failed ]] && die "reset-demo failed — do NOT fire a round against polluted state"
    sleep 2
  done
  [[ $st == done ]] || die "reset-demo did not finish in 120s"

  say "2/5 verify the baseline a judge would see"
  curl -fsS "$SITE/" | grep -q "$DEMO_HEADER" \
    || die "landing page does not read '$DEMO_HEADER' after reset — stop, this is the demo humans open"

  if [[ ${1:-} != --no-deploy ]]; then
    say "3/5 deploy main from the clean tree"
    # Detached, never `checkout main`: the primary checkout holds that branch and
    # git refuses to have it in two worktrees at once. The deploy tree only ever
    # needs the commit, never the branch name.
    # The token is sourced inside this subshell and nowhere else. DEPLOY.md keeps it
    # under MARQUEE_CLOUDFLARE_API_TOKEN precisely so a bare CLOUDFLARE_API_TOKEN
    # never leaks to every tool that sources the platform env; the rename happens on
    # the wrangler line, at the last possible moment.
    ( set -a; . "$CREDENTIALS_ENV"; set +a
      cd "$DEPLOY_TREE" \
      && git fetch github main --quiet && git checkout --quiet --detach github/main \
      && npm run build >/dev/null \
      && CLOUDFLARE_API_TOKEN="${MARQUEE_CLOUDFLARE_API_TOKEN:?not in $CREDENTIALS_ENV}" npx wrangler deploy )

    say "4/5 verify by build hash, not by the page loading"
    local want got
    want=$(cd "$DEPLOY_TREE" && git rev-parse --short=12 github/main)
    for _ in $(seq 1 30); do got=$(live_sha); [[ $got == "$want" ]] && break; sleep 5; done
    [[ $got == "$want" ]] || die "live is $got, main is $want — deploy did not take"
    set_state "sha=\"$got\""
  fi

  say "5/5 barrier clear — live $(live_sha), demo verified clean"
}

cmd_fire() {
  local sha=${1:?usage: loop.sh fire <sha-12>}
  [[ $(jget halted) == True ]] && die "loop is halted"
  round_running && die "REFUSING: a round is already in flight on Atlas. Two runs against
one mutable site interleave their data and both become unreadable."
  local round=$(( $(jget round) + 1 ))

  # An incomplete run directory on Atlas is a resume target. `plan` will pick up
  # the newest unfinished run rather than starting a fresh one, and the new round
  # inherits the old one's scenarios — browsed against a different build, before
  # the barrier reset the demo. That is exactly how "round 7" spent thirteen
  # minutes continuing voided round 6. Archive anything unfinished first: a run
  # with no report.json never completed, and nothing may resume into it.
  say "archiving unfinished runs on Atlas so plan cannot resume one"
  atlas "cd ~/$KIT_ATLAS/runs 2>/dev/null && for d in 2*/; do d=\${d%/}; \
    [ -f \"\$d/report.json\" ] || { mv \"\$d\" \"VOID-\$d\" && echo \"  archived \$d\"; }; done" || true

  say "firing round $round against $sha"
  # Push the kickoff script every time: the version that runs is the version in
  # this repo, not whatever was last hand-edited on the box.
  scp -q "$SELF_DIR/atlas/kickoff-round.sh" "atlas:$KIT_ATLAS/kickoff-round.sh"
  # Declare the freeze BEFORE the round exists, not after. The gap between
  # "browsing has started" and "the marker is on disk" is a window in which a
  # sibling agent reads `stale` and ships — which is how round 4 came to grade two
  # builds. A marker left by a kickoff that refuses is the cheaper failure, and
  # the trap below clears it anyway.
  printf 'round %s grading %s on Atlas since %s — auto-eval coordinator. Lifted by `loop.sh barrier`.\n' \
    "$round" "$sha" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$FREEZE_FILE"
  say "deploy freeze declared at $FREEZE_FILE"

  # The `die` here is what makes a refusal legible, not what stops it running
  # on. It emits the operator-facing diagnostic that
  # tests/node/auto-eval-guards.test.mjs asserts on, and it exits a
  # deterministic 1 where errexit alone would surface ssh's raw 255 with no
  # message at all. The trap fires once, and errexit halts the script either
  # way.
  trap 'rm -f "$FREEZE_FILE"; die "kickoff refused — freeze lifted, no round started"' ERR
  atlas "chmod +x ~/$KIT_ATLAS/kickoff-round.sh && ~/$KIT_ATLAS/kickoff-round.sh $round $sha"
  trap - ERR

  set_state "round=$round" "runStamp=null"
}

case "${1:-status}" in
  status)  shift; cmd_status "$@";;
  sync)    shift; cmd_sync "$@";;
  watch)   shift; cmd_watch "$@";;
  mine)    shift; cmd_mine "$@";;
  guard)   shift; cmd_guard "$@";;
  barrier) shift; cmd_barrier "$@";;
  fire)    shift; cmd_fire "$@";;
  *) die "unknown verb '${1}' — status|sync|watch|mine|guard|barrier|fire";;
esac
