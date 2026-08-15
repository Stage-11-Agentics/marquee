/** The canonical landing path for each Marquee seat. Keep this leaf browser-safe. */
export const ROLE_HOME = {
  staff: "/dashboard",
  reviewer: "/reviewer",
  speaker: "/portal",
  sponsor: "/sponsor-portal",
} as const;
