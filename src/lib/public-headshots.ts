/**
 * Deliberately synthetic avatars for the published demo roster. These are
 * monograms and geometric marks, never photographs or generated faces. The
 * final three published speakers intentionally stay out of this manifest so
 * the public renderer keeps exercising its initials fallback.
 */
export const SYNTHETIC_PUBLIC_HEADSHOT_SLUGS = [
  "grace-isford",
  "hamel-husain",
  "greg-ceccarelli",
  "don-bosco-durai",
  "colin-flaherty",
  "baptiste-roziere",
  "leigh-pember",
  "stephen-chin",
  "jonathan-lowe",
  "bruno-passos",
  "beyang-liu",
  "waseem-alshikh",
  "prashant-mital",
  "toki-sherbakov",
  "barr-yaron",
  "shirsha-chaudhuri",
  "aparna-dhinkaran",
  "diamond-bishop",
  "paul-gilbert",
  "alexander-bricken",
  "joe-bayley",
  "heath-black",
  "xiaofeng-wang",
  "douwe-kiela",
  "swyx",
  "sayash-kapoor",
  "mukund-sridhar",
] as const;

/** Published seeded speakers intentionally rendered with initials only. */
export const INTENTIONAL_PUBLIC_HEADSHOT_FALLBACK_SLUGS = [
  "aarush-selvan",
  "barry-zhang",
  "zack-reneau-wedeen",
] as const;

const SYNTHETIC_HEADSHOT_SET = new Set<string>(SYNTHETIC_PUBLIC_HEADSHOT_SLUGS);

function slugifyPublicHeadshotName(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^-|-$/g, "");
}

export function syntheticPublicHeadshotUrl(name: string, isDemo: boolean): string | null {
  if (!isDemo) return null;
  const slug = slugifyPublicHeadshotName(name);
  return SYNTHETIC_HEADSHOT_SET.has(slug) ? `/headshots/${slug}.svg` : null;
}
