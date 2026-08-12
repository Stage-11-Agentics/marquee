// Publish policy for the public Marquee repository.
//
// The repository publishes its full development history on purpose: the task board, the
// research dossiers, the agent briefs, and the run-state are the record of how the product
// was built and are part of what is being released. This ruleset therefore does not police
// internal texture. It polices the two things that stay true regardless of how open the
// project is:
//
//   1. Third-party material we do not own and cannot relicense under this repository's
//      Apache-2.0 LICENSE — the organizers' brief and video transcripts, a rival entrant's
//      document, competitor captures. These live under a `sources/` directory by convention.
//   2. Operator-private material — the personal `Atin/` zone, the account runbook, real
//      machine paths, tailnet and internal-forge hostnames, and personal email addresses.
//
// Secrets are gitleaks' job, not this file's; `check-repo.mjs` runs both.
//
// String literals below are assembled at runtime so this file does not match its own rules
// when the scan reads it as history content.

const joinParts = (...parts) => parts.join("");

export const DENIED_HISTORY_PATHS = [
  // Third-party sources — never republishable under our LICENSE.
  /(^|\/)sources\//i,
  /\.pdf$/i,
  /(^|\/)competitor-[^/]*$/i,
  // Operator-private.
  /(^|\/)Atin\//i,
  /(^|\/)OPERATOR-PRECONDITIONS(?:\.[^/]*)?$/i,
];

const markerForge = joinParts("forgejo", "\\.", "stage", "11", "\\.", "ai");
const markerTailnet = joinParts("tail", "net");
const personalMailbox = joinParts("benevolent", "\\.", "futures");
const personalDomain = joinParts("atin", "@", "atin", "\\.", "me");

export const DENIED_CONTENT = [
  { label: "private filesystem path", pattern: /\/Users\// },
  { label: "private Atin path", pattern: /(?:^|\/)Atin\//i },
  { label: joinParts("internal Forge", "jo hostname"), pattern: new RegExp(markerForge, "i") },
  { label: joinParts("tail", "net identifier"), pattern: new RegExp(`\\b${markerTailnet}\\b`, "i") },
  // Personal addresses only. Role addresses (the sending identity, the platform account) are
  // shipped deliberately and appear in application source.
  { label: "personal email address", pattern: new RegExp(`${personalMailbox}|${personalDomain}`, "i") },
];

export function findDeniedPaths(paths) {
  return paths.filter((path) => DENIED_HISTORY_PATHS.some((pattern) => pattern.test(path)));
}

export function findDeniedContent(content) {
  return DENIED_CONTENT.filter(({ pattern }) => pattern.test(content)).map(({ label }) => label);
}
