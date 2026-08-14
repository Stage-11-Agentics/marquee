#!/bin/bash
#
# portal-merge-guard.sh — find what a merge silently dropped.
#
# WHY THIS EXISTS
# ---------------
# Every other gate on this box runs on things a compiler can see. `tsc` catches
# a dropped export. Nothing catches a dropped CSS rule. When
# `.portal-error.portal-answer { color: var(--ink) }` vanishes in a merge, the
# result compiles, passes every test, and quietly repaints MRQ-173's "you have
# no speaker record" answer in alarm red — reverting the exact defect that PR
# existed to kill, on the 11-step walkthrough path, invisible to every check we
# run. This is the detector for that class of loss.
#
# It compares YOUR WORKING TREE against a base ref and reports what the base
# has that you do not. It is a post-rebase / post-merge tool: run it after
# resolving conflicts and before you believe the resolution.
#
# It prints what it checked, not just a verdict. Read the coverage; do not
# trust it because it exited 0.
#
# WHAT KIND OF EVIDENCE THIS IS
#   A source-derived negative. It reads files rather than querying a running
#   instrument, which puts it outside the dead-server trap by construction: a
#   file cannot be stale the way a Worker can, and a grep that returns nothing
#   is distinguishable from a grep that failed to run. Its CLEAN is therefore
#   trustworthy for the narrow thing it claims — nothing on the base is absent
#   here — and says nothing at all about whether the merged code behaves.
#
# USAGE
#   portal-merge-guard.sh [--base <ref>] [--tsx <file>] [--css <file>] [-q]
#
#   --base  ref to compare against          (default: github/main)
#   --tsx   component file                  (default: src/ui/portal/PortalPage.tsx)
#   --css   its stylesheet                  (default: src/ui/portal/portal.css)
#   -q      omit the per-probe "ok" lines, print findings and the verdict only
#
#   Run it from inside the worktree you resolved in. Exits non-zero on findings.
#
# WHAT IT CANNOT DO
#   It compares against ONE base. If you are inheriting from two merges, run it
#   once per base ref — a rule added by A and absent from B is invisible to a
#   single-base run. It also cannot know whether a rule SHOULD have gone away;
#   see KNOWN EXCEPTIONS below for how deliberate removals are declared.
#
#   And the boundary that no positive control can rescue: THIS IS A SEARCH, so
#   it is sound for NAMED references and blind to POSITIONAL, ORDINAL and
#   COMPUTED ones by construction. Three couplings it will call CLEAN while the
#   page renders differently:
#
#     - CSS ORDER. It compares sets, not sequence. Two rules of equal
#       specificity that a merge swapped are both present and the later one now
#       wins. Nothing is missing; the cascade changed.
#     - COMPUTED CLASS NAMES. The rendered-class check reads static
#       `class="..."` only. A class built at runtime — class={`x-${state}`} —
#       is invisible to it, which is why its success line says "static".
#     - SPECIFICITY. A surviving rule that a new, more specific selector now
#       overrides is present and inert.
#     - MEDIA CONTEXT. Selector tokens are collected without the @media
#       condition they sit under, because the extraction skips the `@` line and
#       reads the indented rules beneath it. A rule MOVED into or out of a media
#       query is textually present on both sides and behaviourally different —
#       a desktop rule relocated under `(max-width: 580px)` reads as surviving
#       and no longer applies to the case it was written for. Found by #210's
#       reviewer, briefed to hunt a limit this header had not declared.
#
#   Those are found by executing the page, not by reading it. Which is the
#   outer question after any control passes: is a SEARCH even the right
#   instrument for the coupling you are hunting?
#
set -u

BASE="github/main"
TSX="src/ui/portal/PortalPage.tsx"
CSS="src/ui/portal/portal.css"
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --tsx)  TSX="$2";  shift 2 ;;
    --css)  CSS="$2";  shift 2 ;;
    -q)     QUIET=1;   shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git worktree" >&2; exit 2; }
cd "$root" || exit 2
git rev-parse --verify --quiet "$BASE" >/dev/null || { echo "base ref not found: $BASE (try: git fetch github main)" >&2; exit 2; }
[ -f "$TSX" ] || { echo "missing: $TSX" >&2; exit 2; }
[ -f "$CSS" ] || { echo "missing: $CSS" >&2; exit 2; }

fail=0
ok()   { [ "$QUIET" -eq 1 ] || printf '  ok    %s\n' "$1"; }
lost() { printf '  LOST  %s\n' "$1"; fail=1; }
head2() { printf '\n== %s ==\n' "$1"; }

echo "portal-merge-guard: $TSX + $CSS against $BASE ($(git rev-parse --short "$BASE"))"

# ---------------------------------------------------------------------------
# BASE vs MERGE-BASE — read this before you believe a finding.
#
# This tool compares against ONE ref, and its answer depends entirely on that
# ref being the right one. `github/main` is both the default and, on a moving
# board, frequently NOT your merge-base: if something landed on main after you
# rebased, this reports its additions as things YOU dropped. Confident,
# specific, and wrong.
#
# That already happened once: a reviewer ran this against `github/main` while a
# PR had merged mid-review, got three LOST findings, and they were all things
# the branch had simply not inherited yet. So the guard now says so itself
# rather than leaving it to be inferred after a scare.
#
# BOTH readings are useful — which is why this warns instead of choosing:
#   --base <merge-base>   "did MY resolution drop anything?"
#   --base github/main    "what must I inherit before I am allowed to merge?"
# ---------------------------------------------------------------------------
base_sha=$(git rev-parse "$BASE")
merge_base=$(git merge-base HEAD "$BASE" 2>/dev/null || true)
if [ -n "$merge_base" ] && [ "$merge_base" != "$base_sha" ]; then
  behind=$(git rev-list --count "$merge_base..$base_sha" 2>/dev/null || echo "?")
  echo
  echo "  !! $BASE is $behind commit(s) AHEAD of your merge-base ($(git rev-parse --short "$merge_base"))."
  echo "     Findings below may be things you have NOT INHERITED YET rather than things you dropped."
  echo "     Ahead of $BASE, touching these files:"
  git log --oneline "$merge_base..$base_sha" -- "$TSX" "$CSS" | sed 's/^/       /' || true
  echo "     To ask 'did my resolution drop anything?'  ->  --base $(git rev-parse --short "$merge_base")"
  echo "     To ask 'what must I inherit to merge?'     ->  keep this base and rebase."
fi

# ---------------------------------------------------------------------------
# KNOWN EXCEPTIONS
#
# A selector the base styles that this branch deliberately removed, together
# with the markup token that justified it. The pair is what makes this safe:
# the rule may only go if the markup that needed it went too. If the merge
# keeps the base's markup while your branch dropped the rule, that element
# renders unstyled — and this catches it, in the direction that matters.
#
# Declare exceptions as "selector<TAB>markup-token<TAB>reason". Add to this
# list rather than deleting a check, so the next reader sees the decision
# instead of an absence — and REMOVE an entry once it is spent, because a
# stale exception is the same defect as a missing check wearing a comment.
#
# Worked example (now spent, kept as the shape): while #197 was in flight it
# replaced the bare `<span class="overdue">` with `.portal-task-flag.overdue`,
# so main styled `.portal-task-meta .overdue` and the branch did not. The row
# read:
#
#   .portal-task-meta .overdue<TAB>class="overdue"<TAB>#197 replaced the bare span
#
# The PAIR is what made it safe: the rule may only be absent if the markup
# token that needed it is also gone. Once #197 merged, neither existed on main
# and the row was deleted rather than left to reassure.
# ---------------------------------------------------------------------------
EXCEPTIONS=$(cat <<'EOF'
EOF
)

head2 "CSS rules on $BASE with no occurrence in $CSS"
# Selector TOKENS, not rule heads, so a selector you folded into a group still
# counts. Grouped rules are a legitimate refactor; a missing rule is not.
git show "$BASE:$CSS" 2>/dev/null | grep -oE '^[^{@/][^{]*\{' | sed 's/ *{$//' \
  | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sort -u > /tmp/pmg-base-selectors.$$
count=0; missing=0
while read -r sel; do
  count=$((count + 1))
  grep -qF -- "$sel" "$CSS" && continue
  exception=$(printf '%s\n' "$EXCEPTIONS" | awk -F'\t' -v s="$sel" '$1 == s {print $2 "\t" $3}')
  if [ -n "$exception" ]; then
    token=${exception%%	*}
    reason=${exception#*	}
    if grep -qF -- "$token" "$TSX"; then
      lost "$sel — declared a known exception, but $TSX still renders $token, so it would render unstyled"
    else
      ok "$sel absent by design — $reason (and $token is gone from the markup)"
    fi
  else
    lost "$sel — styled on $BASE, absent here"
    missing=$((missing + 1))
  fi
done < /tmp/pmg-base-selectors.$$
rm -f /tmp/pmg-base-selectors.$$
# POSITIVE CONTROL. An empty extraction returns "(none missing)" and looks
# exactly like a clean run. A grep is as silent about a wrong PATH or PATTERN
# as it is about a genuine absence — the failure does not disappear, it moves
# from "my instrument was dead" to "I searched the wrong place". So the check
# must first prove it can find anything at all.
if [ "$count" -eq 0 ]; then
  lost "extracted 0 selectors from $BASE:$CSS — the path or the pattern is wrong, so this check proved NOTHING"
elif [ "$missing" -eq 0 ]; then
  ok "all $count selector tokens on $BASE are present or declared"
fi

head2 "exports on $BASE missing from $TSX"
mainexports=$(git show "$BASE:$TSX" 2>/dev/null | sed -n 's/^export {\(.*\)};$/\1/p' \
  | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$')
mine=$(grep -E '^export ' "$TSX")
emissing=0
for name in $mainexports; do
  if grep -qE "(^|[ ,{])$name([ ,}]|$)" <<<"$mine"; then ok "export $name"
  else lost "export $name — a consumer outside this file imports it"; emissing=1; fi
done
if [ -z "$mainexports" ]; then
  # Control: the base file demonstrably contains `export`, so an empty parse is
  # the pattern's failure rather than the file's silence.
  if git show "$BASE:$TSX" 2>/dev/null | grep -q '^export '; then
    lost "$BASE:$TSX contains export statements but none parsed as a grouped export — the pattern is wrong, so this check proved NOTHING"
  else
    ok "(base declares no exports at all — nothing to compare)"
  fi
elif [ "$emissing" -eq 0 ]; then
  ok "every export on $BASE survives"
fi

head2 "every class the markup renders has a rule that styles it"
# The failure that already happened on this board: a stylesheet rewritten from
# a stale copy, silently dropping rules the markup still asks for. Prefix is
# derived from the stylesheet's own name so this is not portal-specific.
prefix=$(basename "$CSS" .css)
orphans=0
seen=0
for cls in $(grep -oE "class=\"${prefix}-[a-z0-9 -]*\"" "$TSX" | sed 's/class="//;s/"//' \
             | tr ' ' '\n' | sort -u | grep "^${prefix}-"); do
  seen=$((seen + 1))
  grep -qF ".$cls" "$CSS" || { lost ".$cls is rendered but never styled"; orphans=1; }
done
# Control: this file is paired with this stylesheet, so zero matches means the
# prefix guess is wrong, not that the markup renders no classes.
if [ "$seen" -eq 0 ]; then
  lost "found 0 static ${prefix}-* classes in $TSX — the prefix derived from $(basename "$CSS") does not match this markup, so this check proved NOTHING"
elif [ "$orphans" -eq 0 ]; then
  ok "all $seen static ${prefix}-* classes in $TSX have a rule"
fi

# Line number of the first CODE line matching a pattern — comments excluded,
# and the line must actually be a branch.
#
# This exists because of a false positive that fired on a clean tree. The probe
# below used to locate the generic error branch by grepping for its user-facing
# string and taking `head -1`. In this very file the first occurrence is inside
# MRQ-173's explanatory comment, which QUOTES the message in order to explain
# why the 404 branch exists — so the guard compared the real branch at 1063
# against a comment at 1060 and reported LOST on correct code.
#
# The general lesson, worth more than the fix: A PROBE KEYED ON A USER-FACING
# STRING WILL MATCH DOCUMENTATION THAT QUOTES THE STRING. Anchor on code.
# And a detector that fires on the healthy case teaches people to wave it
# through — which is exactly what run-test.mjs says about HARD_LIMIT_MS, and
# the failure this project has already paid for once.
branch_line() {
  grep -nE "$1" "$2" | while IFS= read -r hit; do
    num=${hit%%:*}
    body=${hit#*:}
    trimmed=$(printf '%s' "$body" | sed 's/^[[:space:]]*//')
    case "$trimmed" in '//'*|'*'*|'/*'*) continue ;; esac   # a comment, not code
    case "$body" in *return*) printf '%s\n' "$num"; break ;; esac
  done | head -1
}

head2 "branch-order probes"
# Some inheritances are an ORDER, not a presence. A 404 branch that exists but
# sits after the generic catch-all is dead code that reads as fixed.
if grep -qF 'error.status === 404' "$TSX"; then
  n404=$(branch_line 'error\.status === 404' "$TSX")
  ngen=$(branch_line 'We could not load your portal' "$TSX")
  if [ -n "${n404:-}" ] && [ -n "${ngen:-}" ] && [ "$n404" -lt "$ngen" ]; then
    ok "MRQ-173 404 branch (line $n404) precedes the generic error (line $ngen)"
  else
    lost "MRQ-173 404 branch is at ${n404:-none} and the generic error at ${ngen:-none} — the organizer sees the fault message again"
  fi
elif git show "$BASE:$TSX" 2>/dev/null | grep -qF 'error.status === 404'; then
  lost "MRQ-173 404 branch exists on $BASE and is gone here"
else
  ok "(no 404 branch on either side — probe not applicable)"
fi

head2 "consumers outside this file"
# A semantic conflict has no textual marker: what moves is an export the other
# side consumes. Name them so a human can go look.
consumers=$(grep -rn "from \".*$(basename "$TSX" .tsx)\"" src --include='*.tsx' --include='*.ts' 2>/dev/null \
            | grep -v "^$(dirname "$TSX")/")
if [ -n "$consumers" ]; then printf '%s\n' "$consumers" | sed 's/^/  /';
else echo "  (none outside $(dirname "$TSX"))"; fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "portal-merge-guard: CLEAN — nothing on $BASE is missing here."
  echo
  echo "This is a SOURCE-DERIVED negative: it reads files, not a running"
  echo "instrument, so it is outside the dead-server trap by construction — a"
  echo "file cannot be stale the way a Worker can. Trust it for what it says."
  echo
  echo "What it CANNOT say is whether a surviving rule still wins the cascade,"
  echo "or whether the merged code behaves. That needs the running surface, and"
  echo "there the exposure returns: a dead or stale Worker serves absence for"
  echo "free. So PAIR EVERY ABSENCE CHECK WITH A POSITIVE FROM THE SAME"
  echo "RESPONSE — not \"the alarm colour is gone\" but \"the computed colour IS"
  echo "--ink, and the three routes out are present\". The non-empty half proves"
  echo "the instrument was live; the absent half then counts as evidence."
else
  echo "portal-merge-guard: FINDINGS above. Each is something $BASE has and you do not."
fi
exit "$fail"
