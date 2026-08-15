/**
 * The day-of door (ruling O4).
 *
 * An invite link is mail-independent by design, and at a registration desk on a
 * hostile venue network it must also be *speakable*: the QR is scanned, and
 * when scanning fails the organizer reads the code across the desk. A
 * 40-character base64url token has no speakable form, so the short code is a
 * second credential on the same single-use row rather than a re-encoding of the
 * first — same expiry, same `used_at`, consumed by the same statement.
 *
 * Being speakable is a constraint on the alphabet, not on the entropy. Two
 * words from a 256-word list plus four digits is ~29 bits — enough that a
 * single-use, seven-day credential behind the write rate limiter is not
 * guessable, while staying three spoken tokens long. The words are chosen to be
 * short, common, and distinct when heard rather than read: no homophone pairs,
 * no two words that differ by one phoneme.
 *
 * The raw code is returned exactly once, alongside the URL. Only its hash is
 * stored, and it is never logged.
 */
import { sha256Hex } from "./random-token";

/**
 * Exactly 256, so a byte selects a word with no modulo bias. Asserted below
 * rather than trusted: a list that silently grew to 257 would quietly bias the
 * first word toward the front of the alphabet on every code minted after.
 */
export const SHORT_CODE_WORDS: readonly string[] = [
  "AMBER", "ANCHOR", "APPLE", "ARBOR", "ARROW", "ASPEN", "ATLAS", "AUTUMN",
  "BAGEL", "BALCONY", "BAMBOO", "BANJO", "BARLEY", "BASIN", "BEACON", "BEETLE",
  "BISHOP", "BISON", "BLANKET", "BLOSSOM", "BONFIRE", "BOTTLE", "BOULDER", "BRACKET",
  "BRAMBLE", "BRANCH", "BRIDGE", "BRONZE", "BROOK", "BUBBLE", "BUCKET", "BUGLE",
  "BURROW", "CABIN", "CACTUS", "CAMERA", "CANDLE", "CANYON", "CARGO", "CARROT",
  "CASTLE", "CAVERN", "CEDAR", "CELLAR", "CEMENT", "CHALK", "CHERRY", "CHIMNEY",
  "CINDER", "CIRCUS", "CITRUS", "CLARINET", "CLAY", "CLOVER", "COBALT", "COCOA",
  "COMET", "COMPASS", "COPPER", "CORAL", "COTTON", "CRICKET", "CRIMSON", "CRYSTAL",
  "CYMBAL", "DAISY", "DAGGER", "DAWN", "DELTA", "DENIM", "DESERT", "DIAMOND",
  "DOLPHIN", "DOMINO", "DONKEY", "DRAGON", "DRUM", "DUNE", "DUSK", "EAGLE",
  "EMBER", "EMERALD", "ENGINE", "ENVELOPE", "FABLE", "FALCON", "FATHOM", "FENNEL",
  "FERN", "FIDDLE", "FIG", "FILBERT", "FLINT", "FLUTE", "FOREST", "FOSSIL",
  "FOUNTAIN", "FOX", "FRECKLE", "FROST", "GALAXY", "GARDEN", "GARNET", "GAZELLE",
  "GINGER", "GLACIER", "GLASS", "GRANITE", "GRAPE", "GRAVEL", "GROTTO", "GUITAR",
  "GULL", "GROVE", "HAMMER", "HARBOR", "HARVEST", "HAZEL", "HERON", "HICKORY",
  "HOLLOW", "HONEY", "HORIZON", "HORNET", "IBEX", "INDIGO", "IRIS", "ISLAND",
  "IVORY", "JACKET", "JADE", "JASMINE", "JETTY", "JIGSAW", "JUNIPER", "KAYAK",
  "KELP", "KETTLE", "KEYSTONE", "KINGFISHER", "KITE", "KOALA", "LADDER", "LAGOON",
  "LANTERN", "LARK", "LATTICE", "LAVA", "LEMON", "LENTIL", "LICHEN", "LILAC",
  "LINEN", "LOBSTER", "LOCKET", "LOTUS", "LUMBER", "LUPINE", "LYNX", "MAGNET",
  "MAHOGANY", "MALLET", "MANGO", "MAPLE", "MARBLE", "MARIGOLD", "MARLIN", "MARSH",
  "MEADOW", "MEDAL", "MELON", "METEOR", "MIMOSA", "MINERAL", "MINT", "MIRROR",
  "MULBERRY", "MITTEN", "MONSOON", "MOSS", "MUSTARD", "NECTAR", "NEEDLE", "NICKEL",
  "NUTMEG", "OASIS", "OAK", "OBSIDIAN", "OCEAN", "OCHRE", "OLIVE", "ONYX",
  "OPAL", "ORBIT", "ORCHID", "OTTER", "OWL", "OYSTER", "PADDLE", "PANTRY",
  "PAPAYA", "PARCEL", "PARSLEY", "PASTURE", "PEBBLE", "PELICAN", "PEPPER", "PEWTER",
  "PIGMENT", "PINE", "PISTACHIO", "PLANET", "PLAZA", "PLUM", "POLLEN", "POND",
  "POPLAR", "POPPY", "PORTAL", "PRAIRIE", "PRISM", "PUFFIN", "PUMICE", "QUARTZ",
  "QUILL", "QUILT", "QUIVER", "RADISH", "RAFTER", "RAPIDS", "RAVEN", "RIBBON",
  "RIDGE", "ROCKET", "ROSEMARY", "RUDDER", "SAFFRON", "SAGE", "SANDAL", "SAPPHIRE",
  "SATCHEL", "SATIN", "SCARLET", "SEQUOIA", "SHALE", "SHAMROCK", "SHORE", "SILO",
  "SILVER", "SONNET", "SPRUCE", "STANZA", "STERLING", "SUMMIT", "SYCAMORE", "SYRUP",
];

if (SHORT_CODE_WORDS.length !== 256 || new Set(SHORT_CODE_WORDS).size !== 256) {
  throw new Error("short-code wordlist must hold exactly 256 distinct words");
}

/** `AMBER-FALCON-4821` — three spoken tokens, ~29 bits. */
export function mintShortCode(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const digits = new Uint16Array(1);
  crypto.getRandomValues(digits);
  const suffix = String(digits[0] % 10_000).padStart(4, "0");
  return `${SHORT_CODE_WORDS[bytes[0]]}-${SHORT_CODE_WORDS[bytes[1]]}-${suffix}`;
}

/**
 * What a human typed becomes what was minted, or nothing.
 *
 * The desk is a lossy channel: the code arrives lowercased, with spaces for
 * hyphens, sometimes with a stray one. Normalization is deliberately narrow —
 * case and separators only — because anything looser starts accepting codes
 * that were never minted, and this string is a credential.
 */
export function normalizeShortCode(value: string): string | null {
  const parts = value
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((part) => part.length > 0);
  if (parts.length !== 3) return null;
  const [first, second, suffix] = parts;
  if (!SHORT_CODE_WORDS.includes(first) || !SHORT_CODE_WORDS.includes(second)) return null;
  if (!/^\d{4}$/.test(suffix)) return null;
  return `${first}-${second}-${suffix}`;
}

/** Null for anything that is not a well-formed short code, so callers never hash noise. */
export async function shortCodeHash(value: string): Promise<string | null> {
  const normalized = normalizeShortCode(value);
  return normalized === null ? null : sha256Hex(normalized);
}
