/**
 * The canonical landing path for each Marquee seat. Keep this leaf browser-safe.
 *
 * Program staff land on the organization, not on one conference. A conference
 * is a season; the organization is the thing that outlives every one of them,
 * and it is the row the sidebar itself calls Home. Landing on `/dashboard`
 * asserted which conference the person came for — true for an org with one
 * season, wrong the moment there are two, and never something a sign-in knows.
 * The pipeline is still the conference's own home and one click away, from the
 * org home's conference card or the sidebar row.
 *
 * This is the only definition of that answer. The landing page's demo doors
 * read it too, so a seat has one home no matter which door was used.
 */
export const ROLE_HOME = {
  staff: "/org/home",
  reviewer: "/reviewer",
  speaker: "/portal",
  sponsor: "/sponsor-portal",
} as const;
