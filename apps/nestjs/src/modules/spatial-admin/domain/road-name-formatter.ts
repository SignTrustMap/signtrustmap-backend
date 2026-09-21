/**
 * Generalized normalization pipeline for Vietnamese road names.
 * Standardizes raw geocoding and OSM strings into canonical 2-tier road naming.
 */

const VIETNAMESE_ACCENT_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/**
 * Recognized Vietnamese transportation infrastructure classification prefixes.
 * Any name starting with these is recognized as already classified.
 */
const CLASSIFIER_PREFIX_REGEX =
  /^(Đường(\s+số)?|Phố|Đại lộ|Xa lộ|Cầu|Hầm|Quốc lộ|Tỉnh lộ|Vành đai|Hẻm|Ngõ|Ngách|Đoạn|Bến|Giao lộ|Nút giao)(\s+|$)/i;

/**
 * Directional/navigation noisy prefixes frequently added in OSM tags.
 */
const NOISE_PREFIX_REGEX =
  /^(Hướng đi|Lối vào|Lối ra|Đoạn qua|Đường dẫn vào|Đường nhánh)(\s+đường)?\s+/i;

/**
 * English road classification suffixes mapped to Vietnamese infrastructure prefixes.
 */
const SUFFIX_TO_PREFIX_MAP: Record<string, string> = {
  boulevard: 'Đại lộ',
  avenue: 'Đại lộ',
  street: 'Đường',
  road: 'Đường',
  bridge: 'Cầu',
  tunnel: 'Hầm',
  alley: 'Hẻm',
  lane: 'Ngõ',
};

/**
 * Formats any raw road name into canonical Vietnamese representation:
 * 1. Strips navigation/routing direction prefixes
 * 2. Translates English suffix patterns (<Name> Street -> Đường <Name>)
 * 3. Expands common abbreviations (Đ., QL, TL)
 * 4. Ensures consistent infrastructure prefixing (naked names become Đường <Name>)
 */
export function formatCanonicalRoadName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  let name = rawName.trim();
  if (!name) return null;

  // 1. Strip navigation direction noise
  name = name.replace(NOISE_PREFIX_REGEX, '').trim();
  if (!name) return null;

  // 2. Translate English suffix-to-prefix (e.g. "Nguyen Huu Canh Street" -> "Đường Nguyen Huu Canh")
  const suffixMatch = name.match(/^(.*?)\s+(Boulevard|Avenue|Street|Road|Bridge|Tunnel|Alley|Lane)$/i);
  if (suffixMatch) {
    const [, base, suffix] = suffixMatch;
    const prefix = SUFFIX_TO_PREFIX_MAP[suffix.toLowerCase()] || 'Đường';
    name = `${prefix} ${base.trim()}`;
  }

  // Numbered road suffix translation (e.g. "Street No. 60" -> "Đường số 60")
  name = name.replace(/^(Street|Road)\s+No\.?\s*(\d+)/i, 'Đường số $2');

  // 3. Abbreviation expansions
  name = name.replace(/^Đ\.\s*/i, 'Đường ');
  name = name.replace(/^QL\.?\s*(\d+[A-Z]?)/i, 'Quốc lộ $1');
  name = name.replace(/^TL\.?\s*(\d+[A-Z]?)/i, 'Tỉnh lộ $1');

  // 4. Prefix standardization:
  // If not already starting with a recognized infrastructure classifier, prefix with "Đường "
  if (!CLASSIFIER_PREFIX_REGEX.test(name)) {
    name = `Đường ${name}`;
  }

  return name.trim();
}

/**
 * General linguistic check for properly accented Vietnamese road names.
 * Detects unaccented Vietnamese street names without relying on hardcoded surname whitelists.
 */
export function isCleanVietnameseRoadName(roadName: string | null | undefined): boolean {
  if (!roadName) return false;
  const trimmed = roadName.trim();
  if (!trimmed) return false;

  // Untranslated English road keywords indicate dirty untranslated data
  if (/\b(Street|Road|Boulevard|Avenue|Bridge|Tunnel|Lane|Alley)\b/i.test(trimmed)) {
    return false;
  }

  // Strip classifier prefix to inspect core road name
  const core = trimmed.replace(CLASSIFIER_PREFIX_REGEX, '').trim();

  // Alphanumeric zoned / numbered roads (e.g. "Số 60", "1A", "N2", "D1", "D8")
  const isAlphanumericCode = /^((số\s+)?\d+[a-zA-Z]?|[a-zA-Z]\d+)$/i.test(core);

  // If the core name contains alphabetic letters and is not a simple alphanumeric code,
  // it is a Vietnamese lexical name and MUST contain at least one Vietnamese diacritic mark.
  if (/[a-zA-Z]/.test(core) && !isAlphanumericCode) {
    return VIETNAMESE_ACCENT_REGEX.test(core);
  }

  return true;
}
