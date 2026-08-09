export const DENIED_HISTORY_PATHS = [
  /(^|\/)sources\//i,
  /\.pdf$/i,
  /(^|\/)competitor-[^/]*$/i,
  /(^|\/)AGENT-BRIEF-[^/]*$/,
  /(^|\/)run-state(?:\.[^/]*)?$/i,
];

export const DENIED_CONTENT = [
  { label: "private filesystem path", pattern: /\/Users\// },
  { label: "Stage 11 internal path", pattern: /Stage[- ]?11/i },
  { label: "private Atin path", pattern: /(?:^|\/)Atin\//i },
  { label: "c11 surface identifier", pattern: /\bsurface:\d+/i },
  { label: "c11 workspace identifier", pattern: /\bworkspace:\d+/i },
  { label: "C11 internal identifier", pattern: /\bC11_[A-Z0-9_]+\b/ },
];

export function findDeniedPaths(paths) {
  return paths.filter((path) => DENIED_HISTORY_PATHS.some((pattern) => pattern.test(path)));
}

export function findDeniedContent(content) {
  return DENIED_CONTENT.filter(({ pattern }) => pattern.test(content)).map(({ label }) => label);
}
