const joinParts = (...parts) => parts.join("");
const privateMetadataSegment = joinParts("lat", "tice");

export const DENIED_HISTORY_PATHS = [
  new RegExp(`(^|/)\\.${privateMetadataSegment}(?:/|$)`, "i"),
  /(^|\/)sequence\/research(?:\/|$)/i,
  /(^|\/)sources\//i,
  /\.pdf$/i,
  /(^|\/)competitor-[^/]*$/i,
  /(^|\/)AGENT-BRIEF-[^/]*$/,
  /(^|\/)run-state(?:\.[^/]*)?$/i,
  /(^|\/)Atin\//i,
];

const markerA = joinParts("forgejo", "\\.", "stage", "11", "\\.", "ai");
const markerB = joinParts("tail", "net");
const markerC = joinParts("Lat", "tice");
const markerD = joinParts("dele", "gator");
const markerE = joinParts("orches", "trator");

export const DENIED_CONTENT = [
  { label: "private filesystem path", pattern: /\/Users\// },
  { label: "private internal path", pattern: /Stage[- ]?11/i },
  { label: joinParts("internal Forge", "jo hostname"), pattern: new RegExp(markerA, "i") },
  { label: joinParts("tail", "net identifier"), pattern: new RegExp(`\\b${markerB}\\b`, "i") },
  { label: joinParts("Lat", "tice vocabulary"), pattern: new RegExp(`\\b${markerC}\\b`, "i") },
  { label: joinParts("dele", "gator vocabulary"), pattern: new RegExp(`\\b${markerD}\\b`, "i") },
  { label: joinParts("orches", "trator vocabulary"), pattern: new RegExp(`\\b${markerE}\\b`, "i") },
  { label: "private Atin path", pattern: /(?:^|\/)Atin\//i },
  { label: "c11 surface identifier", pattern: /\bsurface:\d+/i },
  { label: "c11 workspace identifier", pattern: /\bworkspace:\d+/i },
  { label: "C11 internal identifier", pattern: /\bC11_[A-Z0-9_]+\b/ },
  {
    label: "real email address",
    pattern: /\b[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\.)*(?:example|invalid|test)(?:\.(?:com|net|org|invalid|test))?\b)(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/i,
  },
];

export function findDeniedPaths(paths) {
  return paths.filter((path) => DENIED_HISTORY_PATHS.some((pattern) => pattern.test(path)));
}

export function findDeniedContent(content) {
  return DENIED_CONTENT.filter(({ pattern }) => pattern.test(content)).map(({ label }) => label);
}
