/**
 * Speaker social links.
 *
 * Storage does not change shape here: `people.social_links` stays a JSON array
 * of URLs, which is what every importer, the public site and the API already
 * write and read. The platform is *derived from the URL* rather than stored
 * beside it, so a Sessionize import from years ago, a link a speaker pasted
 * into the old free-text box, and a handle typed into today's portal all render
 * the same badge with no migration between them — and a conference that turns a
 * platform off later does not lose the links it already holds.
 *
 * A conference chooses which platforms it asks its speakers for. That choice
 * governs the inputs a speaker is offered, never what is displayed: a link on
 * file is a link the speaker gave, and hiding it because an organizer changed a
 * setting would be the product editing someone's profile behind their back.
 */

export type SocialPlatformId = "x" | "linkedin";

export interface SocialPlatform {
  id: SocialPlatformId;
  /** What the platform calls itself now. */
  label: string;
  /** What most speakers still call it, when that differs. Shown as a hint. */
  alsoKnownAs: string | null;
  /** Fixed text before the input, so the speaker types a handle, not a URL. */
  inputPrefix: string;
  placeholder: string;
  /** How the handle is written when it stands on its own. */
  display: (handle: string) => string;
  /** The canonical URL this product writes for a handle. */
  buildUrl: (handle: string) => string;
  /** Hosts that resolve to this platform, lowercase, `www.` already stripped. */
  hosts: string[];
  /** The handle inside a URL on this platform, or null if the shape is not a profile. */
  handleFromPath: (segments: string[]) => string | null;
}

/**
 * Paths on x.com that are the product, not a person. Without this, a link to
 * `x.com/i/lists/…` would render as a speaker's handle `@i`.
 */
const X_RESERVED = new Set(["i", "home", "search", "explore", "settings", "intent", "share", "hashtag", "messages", "notifications"]);

const PLATFORMS: SocialPlatform[] = [
  {
    id: "x",
    label: "X",
    alsoKnownAs: "Twitter",
    inputPrefix: "x.com/",
    placeholder: "yourhandle",
    display: (handle) => `@${handle}`,
    buildUrl: (handle) => `https://x.com/${handle}`,
    hosts: ["x.com", "twitter.com", "mobile.twitter.com"],
    handleFromPath: (segments) => {
      if (segments.length !== 1) return null;
      const handle = segments[0]!;
      if (X_RESERVED.has(handle.toLowerCase())) return null;
      return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
    },
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    alsoKnownAs: null,
    inputPrefix: "linkedin.com/in/",
    placeholder: "your-profile",
    display: (handle) => `in/${handle}`,
    buildUrl: (handle) => `https://www.linkedin.com/in/${handle}`,
    hosts: ["linkedin.com"],
    handleFromPath: (segments) => {
      // Only a personal profile. Company and school pages are real LinkedIn
      // URLs but they are not this speaker, so they stay as plain links.
      if (segments.length !== 2 || segments[0]!.toLowerCase() !== "in") return null;
      const handle = segments[1]!;
      return /^[A-Za-z0-9À-ɏ-]{1,120}$/.test(handle) ? handle : null;
    },
  },
];

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = PLATFORMS;
export const SOCIAL_PLATFORM_IDS: readonly SocialPlatformId[] = PLATFORMS.map((platform) => platform.id);

/** Every platform this build ships, in the order a conference sees them. */
export function socialPlatform(id: string): SocialPlatform | null {
  return PLATFORMS.find((platform) => platform.id === id) ?? null;
}

/**
 * The platforms a conference asks for. An unset setting means every shipped
 * platform, so a conference that never opens the screen still gets the useful
 * default rather than an empty profile form.
 */
export function readEnabledPlatforms(value: unknown): SocialPlatformId[] {
  const raw = typeof value === "string" ? safeParse(value) : value;
  const listed = raw && typeof raw === "object" && Array.isArray((raw as { platforms?: unknown }).platforms)
    ? (raw as { platforms: unknown[] }).platforms
    : null;
  if (listed === null) return [...SOCIAL_PLATFORM_IDS];
  const chosen = listed.filter((item): item is SocialPlatformId => typeof item === "string" && socialPlatform(item) !== null);
  // Order is the product's, not the stored array's, so the form never reshuffles.
  return SOCIAL_PLATFORM_IDS.filter((id) => chosen.includes(id));
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export interface ClassifiedSocialLink {
  url: string;
  platform: SocialPlatform | null;
  /** The handle on its platform; null for a link we cannot name. */
  handle: string | null;
  /** What to print: the handle for a known platform, the bare host otherwise. */
  label: string;
}

/** The platform a stored URL belongs to, read from the URL itself. */
export function classifySocialLink(rawUrl: string): ClassifiedSocialLink {
  const url = rawUrl.trim();
  let parsed: URL | null = null;
  try {
    parsed = new URL(url.includes("://") ? url : `https://${url}`);
  } catch {
    return { url, platform: null, handle: null, label: url };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url, platform: null, handle: null, label: url };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);
  for (const platform of PLATFORMS) {
    if (!platform.hosts.includes(host)) continue;
    const handle = platform.handleFromPath(segments);
    if (handle === null) break;
    return { url, platform, handle, label: platform.display(handle) };
  }
  return { url, platform: null, handle: null, label: host + (segments.length > 0 ? `/${segments.join("/")}` : "") };
}

export interface SocialLinkSet {
  /** One entry per shipped platform the speaker has a profile on, in product order. */
  profiles: Array<{ platform: SocialPlatform; handle: string; url: string }>;
  /** Everything else the speaker gave us, untouched and still shown. */
  other: string[];
}

/** Split the stored URLs into named profiles and everything else. */
export function splitSocialLinks(urls: readonly string[]): SocialLinkSet {
  const profiles: SocialLinkSet["profiles"] = [];
  const other: string[] = [];
  const claimed = new Set<SocialPlatformId>();
  for (const url of urls) {
    const classified = classifySocialLink(url);
    // A second link on a platform the speaker already has is kept rather than
    // dropped — losing a link silently is worse than showing two.
    if (classified.platform && classified.handle && !claimed.has(classified.platform.id)) {
      claimed.add(classified.platform.id);
      profiles.push({ platform: classified.platform, handle: classified.handle, url: classified.url });
    } else {
      other.push(url);
    }
  }
  profiles.sort((left, right) => SOCIAL_PLATFORM_IDS.indexOf(left.platform.id) - SOCIAL_PLATFORM_IDS.indexOf(right.platform.id));
  return { profiles, other };
}

export interface HandleResult {
  handle: string;
  error: string | null;
}

/**
 * What the speaker typed, read as generously as possible. A pasted profile URL,
 * an `@handle`, and a bare handle all mean the same thing and all work.
 */
export function normalizeHandle(platform: SocialPlatform, raw: string): HandleResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { handle: "", error: null };
  if (/[.]|\//.test(trimmed)) {
    const classified = classifySocialLink(trimmed);
    if (classified.platform?.id === platform.id && classified.handle) return { handle: classified.handle, error: null };
    if (classified.platform && classified.platform.id !== platform.id) {
      return { handle: "", error: `That is a ${classified.platform.label} link. Paste it into the ${classified.platform.label} field instead.` };
    }
    return { handle: "", error: `Enter your ${platform.label} handle, or paste your full ${platform.label} profile link.` };
  }
  const bare = trimmed.replace(/^@+/, "");
  const handle = platform.handleFromPath(platform.id === "linkedin" ? ["in", bare] : [bare]);
  if (handle === null) return { handle: "", error: `That does not look like a ${platform.label} handle.` };
  return { handle, error: null };
}

/**
 * Fold a speaker's per-platform handles back together with the links we could
 * not name, producing the URL array the record stores.
 */
export function composeSocialLinks(handles: ReadonlyMap<SocialPlatformId, string>, other: readonly string[]): string[] {
  const composed: string[] = [];
  for (const id of SOCIAL_PLATFORM_IDS) {
    const handle = handles.get(id)?.trim();
    const platform = socialPlatform(id);
    if (handle && platform) composed.push(platform.buildUrl(handle));
  }
  for (const url of other) {
    const value = url.trim();
    if (value !== "") composed.push(value);
  }
  return composed;
}
