#!/usr/bin/env python3
"""weigh.py — what each non-pass rubric item is worth on the headline.

`mine.mjs` ranks the work queue by flat rubric weight. That is the right lens for
"what should a delegator pick up next", and the wrong one for "how far are we from
100%", because the headline is an *area-weighted* mean of area percentages: a
2-point item in ai-agenda (area weight 10, judgeable ~18) and a 2-point item in
call-for-papers (area weight 20, judgeable ~37) are worth noticeably different
amounts of headline. This computes the real marginal value, so the path-to-100
document can be regenerated instead of re-typed.

    python3 sequence/auto-eval/weigh.py                 # newest run, table
    python3 sequence/auto-eval/weigh.py --json          # machine-readable
    python3 sequence/auto-eval/weigh.py --run runs/2026-08-15T21-19-37

An area with no judgement in the target run falls back to the newest earlier run
that has one, and the row is labelled with where it came from. A mid-flight round
therefore reads as a real board rather than as a hole, which is the whole point of
being able to run this before RUN-COMPLETE. Fallback rows are stale by
construction — they describe a build that is no longer deployed.
"""
from __future__ import annotations
import argparse, json, os, sys, glob

try:
    import yaml
except ImportError:
    sys.exit("needs pyyaml: python3 -m pip install pyyaml")

KIT = os.environ.get("KIT_LOCAL", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", ".eval-kit-agent"))
KIT = os.path.normpath(KIT)

# pass 1.0, partial 0.5, fail/not_found 0, cannot_judge outside the denominator
POINTS = {"pass": 1.0, "partial": 0.5, "fail": 0.0, "not_found": 0.0, "cannot_judge": None}


def load_specs() -> dict:
    out = {}
    for p in sorted(glob.glob(os.path.join(KIT, "specs", "*.yaml"))):
        d = yaml.safe_load(open(p))
        out[d["area"]] = d
    return out


def runs_newest_first() -> list[str]:
    rs = [d for d in glob.glob(os.path.join(KIT, "runs", "2*")) if os.path.isdir(d)]
    return sorted(rs, reverse=True)


def judgement_for(area: str, preferred: str, fallbacks: list[str]):
    """Return (parsed, run_dir) — the preferred run if it judged this area, else the
    newest earlier run that did. Returns (None, None) when nobody has."""
    for run in [preferred] + [r for r in fallbacks if r != preferred]:
        f = os.path.join(run, "judgements", f"{area}.json")
        if os.path.exists(f):
            return json.load(open(f)), run
    return None, None


def weigh(preferred: str) -> dict:
    specs = load_specs()
    fallbacks = runs_newest_first()
    rows, missing = [], []
    for area, spec in specs.items():
        if spec.get("optional"):
            continue  # extra credit is scored outside the headline; it cannot move it
        j, run = judgement_for(area, preferred, fallbacks)
        if j is None:
            missing.append(area)
            continue
        rubric = {r["id"]: r for r in spec["rubric"]}
        verdicts = {i["id"]: i["verdict"] for i in j["items"] if i["id"] in rubric}
        scored = [(rubric[i]["weight"], POINTS[v]) for i, v in verdicts.items()
                  if POINTS[v] is not None]
        judgeable = sum(w for w, _ in scored)
        earned = sum(w * p for w, p in scored)
        if judgeable == 0:
            continue
        aw = spec["area_weight"]
        base = earned / judgeable
        for iid, v in verdicts.items():
            if v == "pass":
                continue
            r = rubric[iid]
            w = r["weight"]
            if v == "cannot_judge":
                # Converting an unjudged item to pass adds it to BOTH the numerator
                # and the denominator, so the gain is not (1-p)*w/judgeable — it can
                # even be negative if the area is already scoring below 100%.
                after = (earned + w) / (judgeable + w)
            else:
                after = (earned + (1 - POINTS[v]) * w) / judgeable
            rows.append({
                "area": area, "id": iid, "verdict": v, "weight": w,
                "testability": r["testability"], "areaWeight": aw,
                "gain": round((after - base) * aw, 2),
                "stale": os.path.basename(run) != os.path.basename(preferred),
                "from": os.path.basename(run),
                "criterion": r["criterion"],
            })
    rows.sort(key=lambda r: -r["gain"])
    return {
        "run": os.path.basename(preferred),
        "unjudgedAreas": missing,
        "recoverable": round(sum(r["gain"] for r in rows), 2),
        "items": rows,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", help="run dir (default: newest under the kit's runs/)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    runs = runs_newest_first()
    if not runs:
        sys.exit(f"no runs under {KIT}/runs")
    run = a.run if a.run else runs[0]
    if not os.path.isabs(run):
        run = os.path.join(KIT, run) if not run.startswith(KIT) else run
    out = weigh(run)
    if a.json:
        print(json.dumps(out, indent=2))
        return
    print(f"run {out['run']}  —  {out['recoverable']} headline points recoverable "
          f"across {len(out['items'])} non-pass items")
    if out["unjudgedAreas"]:
        print(f"  NOT YET JUDGED ANYWHERE: {', '.join(out['unjudgedAreas'])}")
    stale = sorted({r["from"] for r in out["items"] if r["stale"]})
    if stale:
        print(f"  rows marked * fall back to an earlier run ({', '.join(stale)}) "
              f"— they describe a build that is no longer deployed")
    print()
    print(f"{'':1} {'item':<8} {'area':<21} {'verdict':<13} {'testability':<13} "
          f"{'wt':>3} {'gain':>6}")
    for r in out["items"]:
        print(f"{'*' if r['stale'] else ' '} {r['id']:<8} {r['area']:<21} "
              f"{r['verdict']:<13} {r['testability']:<13} {r['weight']:>3} {r['gain']:>6.2f}")


if __name__ == "__main__":
    main()
